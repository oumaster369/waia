/** DEE-1196: synthetic PostgreSQL credential storage, no real HTX request. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

import { createPerRequestPostgresRuntime, getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { HtxExchangeConnector } from "@/lib/trader/connectors/htx/htx-exchange-connector";
import { assertAdminPermission } from "@/lib/trader/admin-route-shared";
import { createPostgresCredentialService } from "@/lib/trader/credentials/credential-service";
import {
  handleOrg0ReadOnlyConnectGet,
  handleOrg0ReadOnlyConnectPost,
  type Org0ReadOnlyConnectDeps,
} from "@/lib/trader/credentials/org0-readonly-connect-handler";
import { SecretsStoreMasterKeyProvider } from "@/lib/trader/security/secrets-store-master-key-provider";
import { traderAuditActions } from "@/lib/trader/types";
import { assertOrgMembershipPostgres } from "@/lib/waia-core/scope/org-context";
import { seedHtrPostgresUser } from "@/tests/integration/htr-postgres-fixture-prelude";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const ADMIN = crypto.randomUUID();
const OTHER = crypto.randomUUID();
const RACE_ADMIN = crypto.randomUUID();
const ACCOUNT = "73737331";
const KEY = "synthetic-org0-access-key";
const SECRET = "synthetic-org0-secret-key";
const ENDPOINT = "https://trader.example.test/api/trader/admin/org0-readonly-connect";
const masterKey = Buffer.alloc(32, 19).toString("base64");

function post(expectedActiveCredentialId: string | null, apiKey = KEY, apiSecret = SECRET) {
  return new Request(ENDPOINT, { method: "POST", headers: { origin: "https://trader.example.test",
    "content-type": "application/json" }, body: JSON.stringify({ apiKey, apiSecret, expectedActiveCredentialId }) });
}

describe.skipIf(!enabled || !url)("DEE-1196 Org0 read-only connect on isolated PostgreSQL", () => {
  let org0: string;
  let otherOrg: string;
  let raceOrg: string;
  let db: ReturnType<typeof getPostgresDrizzle>;
  const venue = vi.fn();
  const provider = () => SecretsStoreMasterKeyProvider.create({
    secretGetter: async () => masterKey, productionReady: true,
  });

  beforeAll(async () => {
    org0 = await seedHtrPostgresUser(url!, ADMIN, "Synthetic Org0 admin");
    otherOrg = await seedHtrPostgresUser(url!, OTHER, "Synthetic unrelated trader");
    raceOrg = await seedHtrPostgresUser(url!, RACE_ADMIN, "Synthetic concurrent Org0 admin");
    db = getPostgresDrizzle();
    await db.update(pgSchema.userPlatformRoles).set({ role: "admin" })
      .where(eq(pgSchema.userPlatformRoles.userId, ADMIN));
    await db.update(pgSchema.userPlatformRoles).set({ role: "admin" })
      .where(eq(pgSchema.userPlatformRoles.userId, RACE_ADMIN));
  });

  afterAll(() => { resetPostgresSingletonForTests(); });

  function deps(options: { onValidated?: () => Promise<void>; permissions?: string[] } = {}): Org0ReadOnlyConnectDeps {
    const runtime = { kind: "postgres" as const, db };
    return {
      getUserId: async () => ADMIN,
      hasTraderAccess: async () => true,
      getRuntimeDb: async () => runtime,
      disposeRuntimeDb: async () => undefined,
      resolveOrg0: () => org0,
      checkAdminPermission: assertAdminPermission,
      assertOrgMembership: assertOrgMembershipPostgres,
      assertSameOrigin: request => request.headers.get("origin") === new URL(request.url).origin ? null :
        { status: 403, outcome: "client_error", body: { error: { code: "ORIGIN", message: "Refused." } } },
      createProvider: provider,
      createConnector: config => {
        expect(config.expectedSpotAccountId).toBe(ACCOUNT);
        return {
          validateCredentials: async () => {
            venue();
            await options.onValidated?.();
            return { valid: true, accountId: ACCOUNT };
          },
          getAccountInfo: async () => ({ accountId: ACCOUNT, venue: "htx", marketType: "spot",
            permissions: options.permissions ?? ["read"] }),
        } as unknown as HtxExchangeConnector;
      },
      createCredentialService: (_runtime: Extract<WaiaRuntimeDb, { kind: "postgres" }>, createProvider) =>
        createPostgresCredentialService(db, { createProvider }),
    };
  }

  it("encrypts and audits exact Org0 create/rotate without enrolling or touching another tenant", async () => {
    const otherService = createPostgresCredentialService(db, { createProvider: provider });
    const other = await otherService.storeCredentials({ organizationId: otherOrg, userId: OTHER }, {
      venue: "htx", exchangeAccountId: ACCOUNT,
      credentials: { apiKey: "unrelated-synthetic-key", apiSecret: "unrelated-synthetic-secret" },
      expectedActiveCredentialId: null,
    });

    const first = await handleOrg0ReadOnlyConnectPost(post(null), deps());
    expect(first.status).toBe(200);
    const firstBody = first.body as { credential: { id: string; apiKeyMasked: string; permissionMetadata: { scopes: string[] } } };
    expect(firstBody.credential.permissionMetadata.scopes).toEqual(["read"]);
    expect(firstBody.credential.apiKeyMasked).not.toBe(KEY);
    expect(JSON.stringify(first.body)).not.toContain(SECRET);
    const [stored] = await db.select().from(pgSchema.exchangeCredentials).where(and(
      eq(pgSchema.exchangeCredentials.organizationId, org0), eq(pgSchema.exchangeCredentials.id, firstBody.credential.id)));
    expect(stored?.encryptedPayload).toBeTruthy();
    expect(stored?.encryptedPayload).not.toContain(KEY);
    expect(stored?.encryptedPayload).not.toContain(SECRET);
    const createdAudit = await db.select().from(pgSchema.auditLogs).where(and(
      eq(pgSchema.auditLogs.organizationId, org0), eq(pgSchema.auditLogs.entityId, firstBody.credential.id),
      eq(pgSchema.auditLogs.action, traderAuditActions.credentialCreated)));
    expect(createdAudit).toHaveLength(1);
    expect(await db.select().from(pgSchema.traderAccountCollectionState).where(
      eq(pgSchema.traderAccountCollectionState.organizationId, org0))).toHaveLength(0);

    const stale = await handleOrg0ReadOnlyConnectPost(post(null, "new-key", "new-secret"), deps());
    expect(stale.status).toBe(409);
    const rotated = await handleOrg0ReadOnlyConnectPost(post(firstBody.credential.id, "new-key", "new-secret"), deps());
    expect(rotated.status).toBe(200);
    const rotatedId = (rotated.body as { credential: { id: string } }).credential.id;
    expect(rotatedId).not.toBe(firstBody.credential.id);
    const old = await db.select().from(pgSchema.exchangeCredentials).where(eq(pgSchema.exchangeCredentials.id, firstBody.credential.id));
    expect(old[0]?.status).toBe("revoked");
    const rotateAudit = await db.select().from(pgSchema.auditLogs).where(and(
      eq(pgSchema.auditLogs.organizationId, org0), eq(pgSchema.auditLogs.entityId, rotatedId),
      eq(pgSchema.auditLogs.action, traderAuditActions.credentialRotated)));
    expect(rotateAudit).toHaveLength(1);
    const otherStill = await db.select().from(pgSchema.exchangeCredentials).where(eq(pgSchema.exchangeCredentials.id, other.id));
    expect(otherStill[0]?.status).toBe("active");
    const get = await handleOrg0ReadOnlyConnectGet(deps());
    expect(get.body).toMatchObject({ credential: { id: rotatedId }, target: { organizationId: org0,
      exchangeAccountId: ACCOUNT } });
  });

  it("fails closed if explicit Org0 membership disappears during validation", async () => {
    const current = (await handleOrg0ReadOnlyConnectGet(deps())).body as { credential: { id: string } };
    const beforeVenueCalls = venue.mock.calls.length;
    const result = await handleOrg0ReadOnlyConnectPost(post(current.credential.id, "race-key", "race-secret"),
      deps({ onValidated: async () => {
        await db.delete(pgSchema.organizationMembers).where(and(
          eq(pgSchema.organizationMembers.organizationId, org0), eq(pgSchema.organizationMembers.userId, ADMIN)));
      } }));
    expect(result.status).toBe(403);
    expect(venue.mock.calls.length).toBe(beforeVenueCalls + 1);
    const active = await db.select().from(pgSchema.exchangeCredentials).where(and(
      eq(pgSchema.exchangeCredentials.organizationId, org0), eq(pgSchema.exchangeCredentials.status, "active")));
    expect(active.map(row => row.id)).toEqual([current.credential.id]);
  });

  it("keeps exactly one encrypted active credential and one audit event across two initial POSTs", async () => {
    const firstRuntime = createPerRequestPostgresRuntime();
    const secondRuntime = createPerRequestPostgresRuntime();
    let arrived = 0;
    let release!: () => void;
    const bothValidated = new Promise<void>(resolve => { release = resolve; });
    const waitForPeer = async () => {
      arrived += 1;
      if (arrived === 2) release();
      await bothValidated;
    };
    const makeDeps = (runtime: typeof firstRuntime): Org0ReadOnlyConnectDeps => ({
      ...deps({ onValidated: waitForPeer }),
      getUserId: async () => RACE_ADMIN,
      resolveOrg0: () => raceOrg,
      getRuntimeDb: async () => runtime,
      disposeRuntimeDb: async () => undefined,
      createCredentialService: (_runtime, createProvider) =>
        createPostgresCredentialService(runtime.db, { createProvider }),
    });
    try {
      const [first, second] = await Promise.all([
        handleOrg0ReadOnlyConnectPost(post(null, "synthetic-race-key-a", "synthetic-race-secret-a"),
          makeDeps(firstRuntime)),
        handleOrg0ReadOnlyConnectPost(post(null, "synthetic-race-key-b", "synthetic-race-secret-b"),
          makeDeps(secondRuntime)),
      ]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const active = await db.select().from(pgSchema.exchangeCredentials).where(and(
        eq(pgSchema.exchangeCredentials.organizationId, raceOrg),
        eq(pgSchema.exchangeCredentials.status, "active")));
      expect(active).toHaveLength(1);
      expect(active[0]?.encryptedPayload).toBeTruthy();
      expect(active[0]?.encryptedPayload).not.toContain("synthetic-race-key");
      expect(active[0]?.encryptedPayload).not.toContain("synthetic-race-secret");
      const audits = await db.select().from(pgSchema.auditLogs).where(and(
        eq(pgSchema.auditLogs.organizationId, raceOrg),
        eq(pgSchema.auditLogs.action, traderAuditActions.credentialCreated)));
      expect(audits).toHaveLength(1);
      expect(audits[0]?.entityId).toBe(active[0]?.id);
      expect(await db.select().from(pgSchema.traderAccountCollectionState).where(
        eq(pgSchema.traderAccountCollectionState.organizationId, raceOrg))).toHaveLength(0);
    } finally {
      await Promise.all([firstRuntime._sql.end({ timeout: 5 }), secondRuntime._sql.end({ timeout: 5 })]);
    }
  });
});
