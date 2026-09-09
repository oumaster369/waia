import { afterAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres, { type Sql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as drizzleSql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createPostgresObservationRepository } from "@/lib/trader/account-observation/postgres-repository";
import { createPostgresObservationReader } from "@/lib/trader/account-observation/postgres-reader";
import { assertFhvV2PostgresSchemaPreflight } from "@/lib/trader/observability/fhv-v2-postgres-schema-preflight";
import * as pgSchema from "@/db/schema.postgres";
import { insertCredentialRowPostgres, getCredentialRowByIdPostgres,
  listCredentialRowsForOrgPostgres, revokeCredentialRowPostgres } from "@/lib/trader/credentials/repository-postgres";

const enabled = process.env.DEE960_LOCAL_PG17 === "1";
const url = "postgres://waia_local_admin:local_validation_only@127.0.0.1:55460/waia_dee960_local";
const migration = "0205_trader_account_observation_v1";
const folder = "db/migrations_postgres";
const journal = JSON.parse(readFileSync(`${folder}/meta/_journal.json`, "utf8")) as {
  entries: { idx: number; when: number; tag: string }[];
};
const normalize = (s: string) => s.replace(/^--[^\n]*(?:\n|$)/gm, "").trim();
it("0205 packages the reviewed local SQL without semantic drift or historical journal changes", () => {
  expect(journal.entries.at(-1)).toMatchObject({ idx: 205, tag: migration, when: 1780000000205 });
  expect(journal.entries.at(-2)?.tag).toBe("0204_historical_preparation_events_v2");
  expect(new Set(journal.entries.map(e => e.tag)).size).toBe(journal.entries.length);
  expect(normalize(readFileSync(`${folder}/${migration}.sql`, "utf8")))
    .toBe(normalize(readFileSync("db/local-validation/dee960-account-observation.sql", "utf8")));
});

describe.skipIf(!enabled)("DEE-960 full migration chain and additive upgrade on PostgreSQL 17", () => {
  const connections: Sql[] = [];
  afterAll(async () => { await Promise.all(connections.map(sql => sql.end({ timeout: 2 }))); });
  async function database() {
    const root = postgres(url, { max: 1, connect_timeout: 3, prepare: false, onnotice: () => {} });
    connections.push(root);
    const version = Number((await root`SHOW server_version_num`)[0].server_version_num);
    expect(version).toBeGreaterThanOrEqual(170000); expect(version).toBeLessThan(180000);
    const name = "dee960_migration_" + randomUUID().replaceAll("-", "");
    await root.unsafe(`CREATE DATABASE "${name}"`);
    const sql = postgres(url.replace("/waia_dee960_local", "/" + name),
      { max: 1, connect_timeout: 3, prepare: false, onnotice: () => {} });
    connections.push(sql);
    await sql.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dee960_local_owner') THEN
        CREATE ROLE dee960_local_owner NOLOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE;
      END IF;
    END $$;
    GRANT CREATE ON DATABASE "${name}" TO dee960_local_owner;
    GRANT USAGE, CREATE ON SCHEMA public TO dee960_local_owner WITH GRANT OPTION;`);
    // Bare Postgres auth stubs only. Never used on Supabase or any external database.
    await sql.begin(async tx => {
      await tx.unsafe("SET LOCAL ROLE dee960_local_owner");
      await tx.unsafe(readFileSync("scripts/postgres-validation/prelude-auth-stub.sql", "utf8"));
      await tx.unsafe("CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)");
    });
    // Existing cluster role can predate this synthetic database. Managed administrator needs
    // explicit role administration for historical migration 0199, not superuser/BYPASSRLS.
    await sql.unsafe("GRANT waia_historical_runner TO dee960_local_owner WITH ADMIN OPTION");
    return sql;
  }
  async function apply(sql: Sql, from: number, through: number) {
    for (const entry of journal.entries.filter(e => e.idx >= from && e.idx <= through)) {
      const source = readFileSync(`${folder}/${entry.tag}.sql`, "utf8");
      try {
        await sql.begin(async tx => {
          await tx.unsafe("SET LOCAL ROLE dee960_local_owner");
          for (const statement of source.split("--> statement-breakpoint")) {
            if (statement.trim()) await tx.unsafe(statement);
          }
          await tx`INSERT INTO drizzle.__drizzle_migrations(hash, created_at)
            VALUES (${createHash("sha256").update(source).digest("hex")}, ${entry.when})`;
        });
      } catch (cause) { throw new Error(`LOCAL_MIGRATION_FAILED:${entry.tag}`, { cause }); }
    }
  }
  async function assertNewSurface(sql: Sql) {
    // Actual historical entry point, actual journal and table catalog, under
    // the same limited migration owner. No scientific calculation is invoked.
    try {
      await sql.unsafe("SET ROLE dee960_local_owner");
      await assertFhvV2PostgresSchemaPreflight({ sql });
    } finally {
      await sql.unsafe("RESET ROLE");
    }
    const tables = await sql`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname IN ('trader_account_collection_state','trader_account_observations') ORDER BY relname`;
    expect(tables).toHaveLength(2);
    expect(tables.every(t => t.relrowsecurity && t.relforcerowsecurity)).toBe(true);
    const roles = await sql`SELECT rolname, rolcanlogin, rolsuper, rolbypassrls FROM pg_roles
      WHERE rolname IN ('waia_account_observer','waia_account_observation_reader')`;
    expect(roles).toHaveLength(2);
    expect(roles.every(r => !r.rolcanlogin && !r.rolsuper && !r.rolbypassrls)).toBe(true);
    expect((await sql`SELECT count(*) FROM drizzle.__drizzle_migrations`)[0].count)
      .toBe(String(journal.entries.filter(e => e.idx <= 205).length));
    expect((await sql`SELECT has_column_privilege('waia_account_observation_reader',
      'public.exchange_credentials','encrypted_payload','SELECT') AS secret,
      has_table_privilege('waia_account_observation_reader','public.trader_account_observations','INSERT') AS write`)[0])
      .toEqual({ secret: false, write: false });
  }
  async function assertLegacyCredentialRepository(sql: Sql, org: string, phase: "0204" | "0205") {
    // Actual unchanged repository, scoped to the limited migration owner rather
    // than the local cluster administrator. No keys, network or provider involved.
    await drizzle(sql, { schema: pgSchema }).transaction(async db => {
      await db.execute(drizzleSql`SET LOCAL ROLE dee960_local_owner`);
      const scope = { organizationId: org };
      const row = await insertCredentialRowPostgres(db, scope, { venue: "htx",
        exchangeAccountId: `synthetic-legacy-${phase}`, encryptedPayload: "synthetic-not-a-key" });
      expect(await getCredentialRowByIdPostgres(db, scope, row.id)).toEqual(row);
      expect((await listCredentialRowsForOrgPostgres(db, scope)).map(item => item.id)).toContain(row.id);
      expect(await getCredentialRowByIdPostgres(db, { organizationId: randomUUID() }, row.id)).toBeNull();
      const revoked = await revokeCredentialRowPostgres(db, scope, row.id);
      expect(revoked).toMatchObject({ id: row.id, status: "revoked" });
      expect(revoked?.revokedAt).toBeInstanceOf(Date);
      expect(await revokeCredentialRowPostgres(db, scope, row.id)).toBeNull();
      if (phase === "0205") {
        expect((await db.execute(drizzleSql`SELECT observation_revision FROM public.exchange_credentials WHERE id=${row.id}`))[0].observation_revision).toBe("2");
      }
    });
  }
  it("applies every unchanged migration through 0205 from an empty DB under limited owner", async () => {
    const sql = await database(); await apply(sql, 0, 205); await assertNewSurface(sql);
  }, 120000);
  it("actual Drizzle migrator applies the entire journal under limited owner", async () => {
    const sql = await database();
    // max:1 guarantees that the migrator uses this session's explicit limited role.
    try {
      await sql.unsafe("SET ROLE dee960_local_owner");
      await migrate(drizzle(sql), { migrationsFolder: folder });
    } finally {
      await sql.unsafe("RESET ROLE");
    }
    await assertNewSurface(sql);
  }, 120000);
  it("upgrades full 0204 schema preserving credential/snapshot data and proves new fence", async () => {
    const sql = await database(); await apply(sql, 0, 204);
    await assertFhvV2PostgresSchemaPreflight({ sql });
    const user = randomUUID(), org = randomUUID(), credential = randomUUID(), snapshot = randomUUID();
    await sql`INSERT INTO auth.users(id) VALUES (${user})`;
    await sql`INSERT INTO public.users(id, identity_label, email) VALUES (${user}, 'Synthetic migration probe', ${`probe-${user}@invalid.local`})`;
    await sql`INSERT INTO public.organizations(id, owner_user_id, kind, name) VALUES (${org}, ${user}, 'personal', 'Synthetic migration probe')`;
    await assertLegacyCredentialRepository(sql, org, "0204");
    await sql`INSERT INTO public.exchange_credentials(id,organization_id,venue,exchange_account_id,encrypted_payload)
      VALUES (${credential},${org},'htx','synthetic-account','synthetic-not-a-key')`;
    await sql`INSERT INTO public.trader_balance_snapshots(id,organization_id,credential_id,venue,exchange_account_id,balances,asset_count,synced_at)
      VALUES (${snapshot},${org},${credential},'htx','synthetic-account','[]',0,now())`;
    const before = (await sql`SELECT to_jsonb(c) AS row FROM public.exchange_credentials c WHERE id=${credential}`)[0].row;
    const oldSnapshot = (await sql`SELECT to_jsonb(s) AS row FROM public.trader_balance_snapshots s WHERE id=${snapshot}`)[0].row;
    await apply(sql, 205, 205); await assertNewSurface(sql);
    await assertLegacyCredentialRepository(sql, org, "0205");
    expect((await sql`SELECT to_jsonb(c)-'observation_revision' AS row FROM public.exchange_credentials c WHERE id=${credential}`)[0].row).toEqual(before);
    expect((await sql`SELECT to_jsonb(s) AS row FROM public.trader_balance_snapshots s WHERE id=${snapshot}`)[0].row).toEqual(oldSnapshot);
    const binding = { organizationId: org, credentialId: credential, exchangeAccountId: "synthetic-account",
      credentialRevision: "1", configurationRevision: "synthetic-config" };
    await sql`INSERT INTO public.trader_account_collection_state(organization_id,credential_id,exchange_account_id,configuration_revision,symbols)
      VALUES (${org},${credential},'synthetic-account','synthetic-config','["BTCUSDT"]')`;
    const repo = createPostgresObservationRepository(sql), reader = createPostgresObservationReader(sql);
    expect(await reader.resolveActiveBinding(binding)).toEqual(binding);
    const lease = await repo.claimDue(binding, "migration-probe", Date.now(), 60000);
    expect(lease).not.toBeNull(); expect(await repo.isCurrent(lease!, Date.now())).toBe(true);
    await sql`UPDATE public.exchange_credentials SET status='revoked' WHERE id=${credential}`;
    expect(await repo.isCurrent(lease!, Date.now())).toBe(false);
    expect(await reader.resolveActiveBinding(binding)).toBeNull();
    expect((await sql`SELECT observation_revision FROM public.exchange_credentials WHERE id=${credential}`)[0].observation_revision).toBe("2");
  }, 120000);
});
