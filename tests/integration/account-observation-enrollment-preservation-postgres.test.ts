import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { enrollSelfServiceAccountObservation } from "@/lib/trader/account-observation/self-service-enroll";
import { createAccountObservationSelfServiceConfiguration } from "@/lib/trader/account-observation/self-service-envelope";
import { handleExchangeCredentialsGet, type ConnectHandlerDeps } from "@/lib/trader/credentials/connect-handler";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";

// Dedicated disposable fixture only; never use DATABASE_URL or another local fixture.
const enabled = process.env.DEE1231_ENROLLMENT_PG17 === "1";
const url = "postgres://postgres:local_enroll_fixture_only@127.0.0.1:55839/waia_enroll_fixture";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const organizationId = personalOrganizationIdFromUserId(userId);
const input = { organizationId, credentialId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", exchangeAccountId: "12345678" };

describe.skipIf(!enabled)("self-service enrollment preserves operator state on PostgreSQL 17", () => {
  let sql: postgres.Sql;
  let db: WaiaPostgresDb;
  beforeAll(async () => {
    sql = postgres(url, { max: 4, prepare: false, connect_timeout: 3, onnotice: () => {}, connection: { application_name: "waia-enrollment-preservation-fixture" } });
    expect(Number((await sql`SHOW server_version_num`)[0].server_version_num)).toBeGreaterThanOrEqual(170000);
    // Minimal real SQL/Drizzle fixture for precisely the tables/columns enrollment uses.
    await sql.unsafe(`CREATE TABLE exchange_credentials (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, venue text NOT NULL,
      exchange_account_id text NOT NULL, status text NOT NULL,
      observation_revision bigint NOT NULL DEFAULT 1,
      observation_read_permitted boolean NOT NULL DEFAULT true,
      permission_metadata jsonb NOT NULL DEFAULT '{"scopes":["readOnly","trade"]}'::jsonb
    ); CREATE TABLE trader_account_collection_state (
      organization_id uuid NOT NULL, credential_id uuid NOT NULL REFERENCES exchange_credentials(id),
      exchange_account_id text NOT NULL, configuration_revision text NOT NULL, symbols jsonb NOT NULL,
      next_due_at timestamptz NOT NULL DEFAULT now(), consecutive_failures integer NOT NULL DEFAULT 0,
      lease_token uuid, lease_owner text, lease_expires_at timestamptz, last_observation_id uuid,
      PRIMARY KEY (organization_id,credential_id,exchange_account_id)
    );`);
    db = drizzle(sql, { schema }) as WaiaPostgresDb;
  });
  beforeEach(async () => {
    await sql`TRUNCATE trader_account_collection_state, exchange_credentials`;
    await sql`INSERT INTO exchange_credentials (id,organization_id,venue,exchange_account_id,status)
      VALUES (${input.credentialId},${organizationId},'htx',${input.exchangeAccountId},'active')`;
  });
  afterAll(async () => { await sql?.end({ timeout: 3 }); });

  const state = async () => (await sql`SELECT * FROM trader_account_collection_state ORDER BY credential_id`);
  async function operatorState(tx: postgres.Sql | postgres.TransactionSql, revision = "sha256:" + "a".repeat(64)) {
    await tx`INSERT INTO trader_account_collection_state
      (organization_id,credential_id,exchange_account_id,configuration_revision,symbols,
       next_due_at,consecutive_failures,lease_token,lease_owner,lease_expires_at,last_observation_id)
      VALUES (${organizationId},${input.credentialId},${input.exchangeAccountId},${revision},'["BTCUSDT","ETHUSDT"]',
       '2030-01-01T00:01:00Z',2,${randomUUID()},'synthetic-v5-observer','2030-01-01T00:02:00Z',${randomUUID()})`;
  }

  it("GET metadata preserves a nondefault V5 revision and every scheduling/lease/symbol field", async () => {
    await operatorState(sql);
    const before = await state();
    const credentialsBefore = await sql`SELECT * FROM exchange_credentials`;
    const metadata = { id: input.credentialId, venue: "htx", exchangeAccountId: input.exchangeAccountId,
      status: "active" as const, apiKeyMasked: "synthetic", permissionMetadata: { scopes: ["readOnly","trade"] },
      createdAt: new Date(0), updatedAt: new Date(0), revokedAt: null };
    const provider = vi.fn(async () => { throw new Error("NO_DECRYPTION"); });
    const connector = vi.fn(() => { throw new Error("NO_VENUE"); });
    const deps: ConnectHandlerDeps = {
      getUserId: async () => userId, hasTraderAccess: async () => true,
      getRuntimeDb: async () => ({ kind: "postgres", db }), disposeRuntimeDb: async () => undefined,
      createProvider: provider, createConnector: connector,
      createCredentialService: () => ({
        listCredentialMetadata: async () => [metadata],
        storeCredentials: async () => { throw new Error("NO_STORE_IN_LIST"); },
        getDecryptedCredentials: async () => { throw new Error("NO_DECRYPTION_IN_LIST"); },
        revokeCredentials: async () => { throw new Error("NO_REVOKE_IN_LIST"); },
      }),
    };
    expect((await handleExchangeCredentialsGet(deps)).status).toBe(200);
    expect((await handleExchangeCredentialsGet(deps)).status).toBe(200);
    expect(await state()).toEqual(before);
    expect(await sql`SELECT * FROM exchange_credentials`).toEqual(credentialsBefore);
    expect(provider).not.toHaveBeenCalled(); expect(connector).not.toHaveBeenCalled();
  });

  it("preserves an existing legacy row and inserts missing Read+Trade enrollment without changing purpose", async () => {
    const credentialsBefore = await sql`SELECT * FROM exchange_credentials`;
    expect(await enrollSelfServiceAccountObservation(db, input)).toBe("PROVISIONED");
    const before = await state();
    expect(before[0].configuration_revision).toBe(createAccountObservationSelfServiceConfiguration().revision);
    expect(await enrollSelfServiceAccountObservation(db, input)).toBe("ALREADY_PROVISIONED");
    expect(await state()).toEqual(before);
    expect(await sql`SELECT * FROM exchange_credentials`).toEqual(credentialsBefore);
  });

  it("keeps the concurrent operator winner after waiting for the insertion capacity lock", async () => {
    let pending: Promise<unknown> | undefined;
    await sql.begin(async tx => {
      await operatorState(tx);
      pending = enrollSelfServiceAccountObservation(db, input);
      let waiting = false;
      for (let n = 0; n < 100; n++) {
        const rows = await sql`SELECT 1 FROM pg_stat_activity WHERE application_name='waia-enrollment-preservation-fixture'
          AND wait_event_type='Lock' AND wait_event='relation'`;
        if (rows.length) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    });
    expect(await pending).toBe("ALREADY_PROVISIONED");
    const rows = await state();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ configuration_revision: "sha256:" + "a".repeat(64), symbols: ["BTCUSDT","ETHUSDT"], lease_owner: "synthetic-v5-observer", consecutive_failures: 2 });
  });

  it("does not repurpose an old credential row when a replacement identity is enrolled", async () => {
    await operatorState(sql); const before = await state();
    await sql`UPDATE exchange_credentials SET status='revoked', observation_revision=2 WHERE id=${input.credentialId}`;
    await expect(enrollSelfServiceAccountObservation(db, input)).rejects.toMatchObject({ code: "CREDENTIAL" });
    const replacement = { ...input, credentialId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
    await sql`INSERT INTO exchange_credentials (id,organization_id,venue,exchange_account_id,status)
      VALUES (${replacement.credentialId},${organizationId},'htx',${input.exchangeAccountId},'active')`;
    expect(await enrollSelfServiceAccountObservation(db, replacement)).toBe("PROVISIONED");
    const rows = await state(); expect(rows[0]).toEqual(before[0]);
    expect(rows[1].configuration_revision).toBe(createAccountObservationSelfServiceConfiguration().revision);
  });
});
