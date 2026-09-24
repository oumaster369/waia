/** Real migrated, disposable local/CI database. Immutable synthetic evidence is retained. */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema.postgres";
import type { AdminPostgresDb } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { readOverviewSnapshot } from "@/lib/trader/admin-console/repositories/overview.postgres";
import { handleAdminConsoleAccountsGet } from "@/lib/trader/admin-console/handlers/accounts";
import { readAssistantTool } from "@/lib/trader/admin-console/handlers/assistant-reads";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { consoleObservation } from "@/tests/helpers/admin-console-observation";

const url = process.env.DATABASE_URL_POSTGRES;
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && Boolean(url);
const now = Date.now();
const bounds = { start: new Date(now - 86400_000).toISOString(), end: new Date(now).toISOString() };
describe.skipIf(!enabled)("scoped financial snapshot on Postgres", () => {
  let client: postgres.Sql;
  let db: AdminPostgresDb;
  const adminId = randomUUID();
  let a: Awaited<ReturnType<typeof seed>>;
  let b: Awaited<ReturnType<typeof seed>>;
  let stale: Awaited<ReturnType<typeof seed>>;
  const deps = (): AdminRouteHandlerDeps => ({
    getUserId: async () => adminId,
    getRuntimeDb: async () => ({ kind: "postgres", db, _sql: client }),
    disposeRuntimeDb: async () => undefined,
  });
  async function seed(amount: string, at = now) {
    const userId = randomUUID();
    await client`INSERT INTO auth.users (id) VALUES (${userId}::uuid)`;
    await client`INSERT INTO users (id, identity_label, email) VALUES (${userId}::uuid, 'Synthetic admin audit', ${`${userId}@waia.invalid`})`;
    await ensureUserCoreSeedPostgres(db, { userId, displayName: "Synthetic" });
    const binding = {
      organizationId: personalOrganizationIdFromUserId(userId),
      credentialId: randomUUID(),
      exchangeAccountId: randomUUID(),
      credentialRevision: "1",
      configurationRevision: "test",
    };
    await client`INSERT INTO exchange_credentials (id, organization_id, venue, exchange_account_id, encrypted_payload) VALUES (${binding.credentialId}::uuid, ${binding.organizationId}::uuid, 'htx', ${binding.exchangeAccountId}, 'synthetic-not-a-key')`;
    await client`INSERT INTO trader_account_collection_state (organization_id, credential_id, exchange_account_id, configuration_revision, symbols) VALUES (${binding.organizationId}::uuid, ${binding.credentialId}::uuid, ${binding.exchangeAccountId}, 'test', '["BTCUSDT"]')`;
    await append(binding, amount, at);
    return binding;
  }
  async function append(
    binding: Parameters<typeof consoleObservation>[0],
    amount: string | null,
    at: number,
  ) {
    const observation = consoleObservation(binding, amount, at);
    await client`INSERT INTO trader_account_observations (organization_id, credential_id, exchange_account_id, observation_id, credential_revision, configuration_revision, lease_token, payload, recorded_at)
      VALUES (${binding.organizationId}::uuid, ${binding.credentialId}::uuid, ${binding.exchangeAccountId}, ${observation.observationId}::uuid, 1, 'test', ${randomUUID()}::uuid, ${JSON.stringify(observation)}::jsonb, ${new Date(at).toISOString()}::timestamptz)`;
    await client`UPDATE trader_account_collection_state SET last_observation_id = ${observation.observationId}::uuid WHERE credential_id = ${binding.credentialId}::uuid`;
  }
  const read = (binding: typeof a, mode = "live") =>
    readOverviewSnapshot(db, {
      ...bounds,
      nowMs: now,
      currency: "USDT",
      mode,
      scope: {
        kind: "account",
        organizationId: binding.organizationId,
        exchangeAccountId: binding.exchangeAccountId,
      },
    });
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname))
      throw new Error("TEST_REQUIRES_LOCAL_DISPOSABLE_POSTGRES");
    client = postgres(url!, { max: 3, prepare: false });
    db = drizzle(client, { schema });
    await client`INSERT INTO auth.users (id) VALUES (${adminId}::uuid)`;
    await client`INSERT INTO users (id, identity_label, email) VALUES (${adminId}::uuid, 'Admin', ${`${adminId}@waia.invalid`})`;
    await ensureUserCoreSeedPostgres(db, { userId: adminId, displayName: "Admin" });
    await client`UPDATE user_platform_roles SET role = 'admin' WHERE user_id = ${adminId}::uuid`;
    a = await seed("9007199254740993.00000001");
    b = await seed("900");
    stale = await seed("17", now - 7 * 86400_000);
  });
  afterAll(async () => {
    await client?.end();
  });

  it("keeps scope, exact decimals, account rows and aggregate in the same snapshot", async () => {
    const snapshot = await read(a);
    expect(snapshot.cursor).toMatch(/^\d+$/);
    expect(snapshot.value.accounts).toHaveLength(1);
    expect(snapshot.value.overview.finance.equity.value?.amount).toBe("9007199254740993.00000001");
    expect(snapshot.value.accounts[0]?.equity).toBe(
      snapshot.value.overview.finance.equity.value?.amount,
    );
    expect(JSON.stringify(snapshot.value)).not.toContain(b.exchangeAccountId);
  });
  it("deduplicates credentials and derives first connection from successful observations", async () => {
    await client`INSERT INTO exchange_credentials (id, organization_id, venue, exchange_account_id, encrypted_payload, status) VALUES (${randomUUID()}::uuid, ${a.organizationId}::uuid, 'htx', ${a.exchangeAccountId}, 'synthetic-not-a-key', 'revoked')`;
    const snapshot = await read(a);
    expect(snapshot.value.accounts).toHaveLength(1);
    expect(snapshot.value.accounts[0]).toMatchObject({
      credentialsCount: 2,
      connectedSince: new Date(now).toISOString(),
    });
  });
  it("does not repeat real funds in paper or history", async () => {
    for (const mode of ["paper", "history"]) {
      const snapshot = await read(a, mode);
      expect(snapshot.value.overview.finance.equity.value).toBeNull();
      expect(snapshot.value.accounts[0]?.reason).toBe("EXCHANGE_BALANCE_LIVE_ONLY");
    }
  });
  it("excludes stale observations and retains last complete evidence after an error", async () => {
    expect((await read(stale)).value.overview.finance.equity.value).toBeNull();
    await append(b, null, now + 1);
    const snapshot = await read(b);
    expect(snapshot.value.accounts[0]).toMatchObject({
      included: false,
      stale: true,
      equity: "900",
      reason: "OBSERVATION_ERROR",
    });
    expect(snapshot.value.overview.lastKnownEstimate).toBe("900");
  });
  it("uses exactly the same scope and financial revision for HTTP and assistant", async () => {
    const query = new URLSearchParams({
      organization_id: a.organizationId,
      exchange_account_id: a.exchangeAccountId,
      mode: "live",
      period: "custom",
      from: bounds.start,
      to: bounds.end,
      currency: "USDT",
    });
    const request = new Request(`http://localhost/api/trader/admin/console/accounts?${query}`);
    const direct = await handleAdminConsoleAccountsGet(request, deps());
    const assistant = await readAssistantTool("list_accounts", request, deps());
    expect(direct.status).toBe(200);
    const directBody = direct.body as Record<string, unknown>;
    const assistantBody = assistant.body as Record<string, unknown>;
    expect(assistantBody.data).toEqual(directBody.data);
    expect(assistantBody.financeRevision).toBe(directBody.financeRevision);
    expect(JSON.stringify(assistantBody)).not.toContain(b.exchangeAccountId);
  });
  it("detects ownership conflict even when only one organization is requested", async () => {
    await client`INSERT INTO exchange_credentials (id, organization_id, venue, exchange_account_id, encrypted_payload) VALUES (${randomUUID()}::uuid, ${b.organizationId}::uuid, 'htx', ${a.exchangeAccountId}, 'synthetic-not-a-key')`;
    const snapshot = await read(a);
    expect(snapshot.value.accounts[0]).toMatchObject({
      included: false,
      equity: null,
      reason: "OWNERSHIP_CONFLICT",
    });
    expect(snapshot.value.overview.finance.equity.value).toBeNull();
  });

  it("keeps the full denominator and explicit reasons beyond the 64-account valuation budget", async () => {
    for (let i = 0; i < 65; i++) {
      await client`INSERT INTO exchange_credentials (id, organization_id, venue, exchange_account_id, encrypted_payload) VALUES (${randomUUID()}::uuid, ${stale.organizationId}::uuid, 'htx', ${`cap-${stale.organizationId}-${i}`}, 'synthetic-not-a-key')`;
    }
    const snapshot = await readOverviewSnapshot(db, {
      ...bounds,
      nowMs: now,
      currency: "USDT",
      mode: "live",
      scope: { kind: "organization", organizationId: stale.organizationId },
    });
    expect(snapshot.value.accounts).toHaveLength(66);
    expect(snapshot.value.overview.total).toBe(66);
    expect(snapshot.value.capped).toBe(true);
    expect(
      snapshot.value.accounts.filter((account) => account.reason === "ACCOUNT_CAP"),
    ).toHaveLength(2);
  });
});
