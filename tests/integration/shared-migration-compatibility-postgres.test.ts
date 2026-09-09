import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema.postgres";
import { assertFhvV2PostgresSchemaPreflight } from "@/lib/trader/observability/fhv-v2-postgres-schema-preflight";
import {
  getCredentialRowByIdPostgres,
  insertCredentialRowPostgres,
  listCredentialRowsForOrgPostgres,
  revokeCredentialRowPostgres,
} from "@/lib/trader/credentials/repository-postgres";

const folder = "db/migrations_postgres";
const tag = "0205_trader_account_observation_v1";
const hash = "aa511acd320b653858e4b064dfeb1af744a4d7f81cffaf72fb67cd91f1fffde1";
const journal = JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8")) as {
  entries: { idx: number; when: number; tag: string }[];
};
it("binds the exact frozen0205 bytes and contiguous journal without a second0205", () => {
  expect(
    createHash("sha256")
      .update(readFileSync(join(folder, `${tag}.sql`)))
      .digest("hex"),
  ).toBe(hash);
  expect(journal.entries.at(-1)).toEqual({
    idx: 205,
    when: 1780000000205,
    tag,
    version: "7",
    breakpoints: true,
  });
  expect(journal.entries.map((e) => e.idx)).toEqual(Array.from({ length: 206 }, (_, i) => i));
  expect(new Set(journal.entries.map((e) => e.tag)).size).toBe(206);
  expect(new Set(journal.entries.map((e) => e.when)).size).toBe(206);
});

describe.skipIf(process.env.WAIA_SHARED_PG17 !== "1")(
  "DEE-976 isolated shared PostgreSQL17 compatibility",
  () => {
    const connections: postgres.Sql[] = [];
    let root: postgres.Sql, upgraded: postgres.Sql;
    let raw: string, baselineFolder: string;
    const marker = process.env.WAIA_SHARED_PG17_MARKER;
    const user = randomUUID(),
      org = randomUUID(),
      otherOrg = randomUUID();
    const credential = randomUUID(),
      otherCredential = randomUUID(),
      snapshot = randomUUID(),
      observation = randomUUID();
    beforeAll(async () => {
      raw = process.env.WAIA_SHARED_PG17_URL ?? "";
      const url = new URL(raw);
      // The integrator additionally inspects Docker id→port→owner-label binding.
      // This code cannot prove container ownership from an environment string alone.
      if (
        !marker ||
        !/^[a-f0-9]{64}$/.test(process.env.WAIA_SHARED_PG17_CONTAINER ?? "") ||
        url.protocol !== "postgres:" ||
        url.hostname !== "127.0.0.1" ||
        url.port !== process.env.WAIA_SHARED_PG17_PORT ||
        url.pathname !== "/dee976_local" ||
        url.username !== "dee976_local_owner" ||
        url.search ||
        url.hash
      )
        throw Error("WRONG_OWNED_LOCAL_TARGET");
      root = connect(raw);
      const [identity] = await root`select current_database() db,current_user role,
      current_setting('waia.fixture_token',true) marker,current_setting('server_version_num') version`;
      if (
        identity.db !== "dee976_local" ||
        identity.role !== "dee976_local_owner" ||
        identity.marker !== marker ||
        Number(identity.version) < 170000 ||
        Number(identity.version) >= 180000
      )
        throw Error("WRONG_FIXTURE_IDENTITY");
      const [existing] =
        await root`select to_regclass('public.users') table,exists(select 1 from pg_roles where rolname='dee976_ddl') role`;
      if (existing.table || existing.role) throw Error("EXPECTED_UNUSED_FIXTURE");
      await root.unsafe("CREATE ROLE dee976_ddl NOLOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE");
      baselineFolder = mkdtempSync(join(tmpdir(), "dee976-baseline-"));
      mkdirSync(join(baselineFolder, "meta"));
      const entries = journal.entries.filter((e) => e.idx <= 204);
      writeFileSync(
        join(baselineFolder, "meta/_journal.json"),
        JSON.stringify({ ...journal, entries }),
      );
      for (const e of entries)
        copyFileSync(join(folder, `${e.tag}.sql`), join(baselineFolder, `${e.tag}.sql`));
    });
    afterAll(async () => {
      await Promise.all(connections.map((s) => s.end({ timeout: 2 })));
      if (baselineFolder) rmSync(baselineFolder, { recursive: true }); // only this test's mkdtemp copy
    });
    function connect(url: string) {
      const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 3, onnotice: () => {} });
      connections.push(sql);
      return sql;
    }
    async function database() {
      const name = "dee976_" + randomUUID().replaceAll("-", "");
      await root.unsafe(`CREATE DATABASE "${name}"`);
      const url = new URL(raw);
      url.pathname = "/" + name;
      const sql = connect(url.toString());
      await sql.unsafe(`GRANT CREATE ON DATABASE "${name}" TO dee976_ddl;
      GRANT USAGE,CREATE ON SCHEMA public TO dee976_ddl WITH GRANT OPTION; SET ROLE dee976_ddl`);
      await sql.unsafe(readFileSync("scripts/postgres-validation/prelude-auth-stub.sql", "utf8"));
      await sql.unsafe("RESET ROLE");
      return sql;
    }
    async function apply(sql: postgres.Sql, migrationsFolder: string) {
      try {
        await sql.unsafe("SET ROLE dee976_ddl");
        expect(
          (await sql`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`)[0],
        ).toEqual({ rolsuper: false, rolbypassrls: false });
        await migrate(drizzle(sql), { migrationsFolder });
        await assertFhvV2PostgresSchemaPreflight({ sql });
      } finally {
        await sql.unsafe("RESET ROLE");
      }
    }
    async function legacyConsumer(sql: postgres.Sql, account: string) {
      const queries: string[] = [];
      const db = drizzle(sql, {
        schema,
        logger: {
          logQuery: (query) => {
            queries.push(query);
          },
        },
      });
      const scoped = { organizationId: org };
      await sql.unsafe("SET ROLE dee976_ddl");
      try {
        const row = await insertCredentialRowPostgres(db, scoped, {
          venue: "htx",
          exchangeAccountId: account,
        });
        expect((await getCredentialRowByIdPostgres(db, scoped, row.id))?.id).toBe(row.id);
        expect(
          await getCredentialRowByIdPostgres(db, { organizationId: otherOrg }, row.id),
        ).toBeNull();
        expect(
          (await listCredentialRowsForOrgPostgres(db, scoped)).some((c) => c.id === row.id),
        ).toBe(true);
        expect((await revokeCredentialRowPostgres(db, scoped, row.id))?.status).toBe("revoked");
        expect(queries.length).toBeGreaterThanOrEqual(6);
        expect(queries.every((query) => !query.includes("observation_revision"))).toBe(true);
      } finally {
        await sql.unsafe("RESET ROLE");
      }
    }
    it("actual Drizzle fresh0000–0205 under a non-super/non-bypass migration owner", async () => {
      const sql = await database();
      await apply(sql, folder);
      expect((await sql`select count(*) n from drizzle.__drizzle_migrations`)[0].n).toBe("206");
      const tables = await sql`select relname,relrowsecurity,relforcerowsecurity from pg_class
      where relname in ('trader_account_collection_state','trader_account_observations')`;
      expect(tables).toHaveLength(2);
      expect(tables.every((t) => t.relrowsecurity && t.relforcerowsecurity)).toBe(true);
      const roles = await sql`select rolcanlogin,rolsuper,rolbypassrls from pg_roles
      where rolname in ('waia_account_observer','waia_account_observation_reader')`;
      expect(roles).toHaveLength(2);
      expect(roles.every((r) => !r.rolcanlogin && !r.rolsuper && !r.rolbypassrls)).toBe(true);
    }, 120000);
    it("actual204→205 preserves credentials/snapshots and legacy read/insert/revoke on BOTH schemas", async () => {
      upgraded = await database();
      await apply(upgraded, baselineFolder);
      expect((await upgraded`select count(*) n from drizzle.__drizzle_migrations`)[0].n).toBe(
        "205",
      );
      await upgraded`insert into auth.users(id) values(${user})`;
      await upgraded`insert into public.users(id,identity_label,email) values(${user},'Synthetic compatibility test',${user + "@invalid.local"})`;
      await upgraded`insert into public.organizations(id,owner_user_id,kind) values(${org},${user},'personal'),(${otherOrg},${user},'personal')`;
      await upgraded`insert into public.exchange_credentials(id,organization_id,venue,exchange_account_id,encrypted_payload)
      values(${credential},${org},'htx','synthetic-account','synthetic-not-a-key'),(${otherCredential},${otherOrg},'htx','other-account','synthetic-not-a-key')`;
      await upgraded`insert into public.trader_balance_snapshots(id,organization_id,credential_id,venue,exchange_account_id,balances,asset_count,synced_at)
      values(${snapshot},${org},${credential},'htx','synthetic-account','[]',0,now())`;
      await legacyConsumer(upgraded, "before0205");
      const old = (
        await upgraded`select to_jsonb(c) r from public.exchange_credentials c where id=${credential}`
      )[0].r;
      const snap = (
        await upgraded`select to_jsonb(s) r from public.trader_balance_snapshots s where id=${snapshot}`
      )[0].r;
      await apply(upgraded, folder);
      expect(
        (
          await upgraded`select to_jsonb(c)-'observation_revision' r from public.exchange_credentials c where id=${credential}`
        )[0].r,
      ).toEqual(old);
      expect(
        (
          await upgraded`select to_jsonb(s) r from public.trader_balance_snapshots s where id=${snapshot}`
        )[0].r,
      ).toEqual(snap);
      await legacyConsumer(upgraded, "after0205");
      await upgraded`insert into public.trader_account_collection_state(organization_id,credential_id,exchange_account_id,configuration_revision,symbols)
      values(${org},${credential},'synthetic-account','config','["BTCUSDT"]'),(${otherOrg},${otherCredential},'other-account','config','["BTCUSDT"]')`;
      await upgraded`insert into public.trader_account_observations(organization_id,credential_id,exchange_account_id,observation_id,credential_revision,configuration_revision,lease_token,payload)
      values(${org},${credential},'synthetic-account',${observation},1,'config',${randomUUID()},'{}')`;
    }, 120000);
    it.each(["anon", "authenticated"])(
      "denies %s browser access to both new tables",
      async (role) => {
        for (const table of ["trader_account_collection_state", "trader_account_observations"]) {
          await expect(
            upgraded.begin(async (tx) => {
              await tx.unsafe(`SET LOCAL ROLE ${role}`);
              await tx.unsafe(`SELECT * FROM public.${table}`);
            }),
          ).rejects.toMatchObject({ code: "42501" });
        }
      },
    );
    async function scopedRole(
      role: "waia_account_observer" | "waia_account_observation_reader",
      callback: (tx: postgres.TransactionSql) => Promise<void>,
    ) {
      await upgraded.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        await tx`select set_config('waia.observation_org',${org},true),set_config('waia.observation_credential',${credential},true),set_config('waia.observation_account','synthetic-account',true)`;
        await callback(tx);
      });
    }
    it.each(["waia_account_observer", "waia_account_observation_reader"] as const)(
      "fences %s by exact org/credential/account and denies secrets",
      async (role) => {
        await upgraded.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL ROLE ${role}`);
          expect(await tx`select id from public.exchange_credentials`).toHaveLength(0);
        });
        await scopedRole(role, async (tx) => {
          expect(await tx`select id from public.exchange_credentials`).toEqual([
            { id: credential },
          ]);
          expect(
            await tx`select credential_id from public.trader_account_collection_state`,
          ).toEqual([{ credential_id: credential }]);
          for (const [key, value] of [
            ["waia.observation_org", otherOrg],
            ["waia.observation_credential", otherCredential],
            ["waia.observation_account", "other-account"],
          ]) {
            await tx`select set_config(${key},${value},true)`;
            expect(
              await tx`select observation_id from public.trader_account_observations`,
            ).toHaveLength(0);
            await tx`select set_config('waia.observation_org',${org},true),set_config('waia.observation_credential',${credential},true),set_config('waia.observation_account','synthetic-account',true)`;
          }
        });
        await expect(
          scopedRole(role, async (tx) => {
            await tx`select encrypted_payload from public.exchange_credentials`;
          }),
        ).rejects.toMatchObject({ code: "42501" });
      },
    );
    it("reader cannot mutate; observer cannot forge revisions; immutable evidence remains unchanged", async () => {
      await expect(
        scopedRole("waia_account_observation_reader", async (tx) => {
          await tx`update public.trader_account_collection_state set consecutive_failures=1`;
        }),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        scopedRole("waia_account_observation_reader", async (tx) => {
          await tx`insert into public.trader_account_observations(organization_id) values(${org})`;
        }),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        scopedRole("waia_account_observer", async (tx) => {
          await tx`update public.exchange_credentials set observation_revision=2 where id=${credential}`;
        }),
      ).rejects.toThrow("OBSERVATION_REVISION_IS_DATABASE_OWNED");
      await expect(
        upgraded`update public.trader_account_observations set payload='{"changed":true}' where observation_id=${observation}`,
      ).rejects.toThrow("ACCOUNT_OBSERVATION_IMMUTABLE");
      expect(
        (
          await upgraded`select payload from public.trader_account_observations where observation_id=${observation}`
        )[0].payload,
      ).toEqual({});
    });
    it("actual historical preflight rejects invalid journal/table states, each rolled back", async () => {
      const probes: [string, string][] = [
        [
          "delete from drizzle.__drizzle_migrations where created_at=1780000000204",
          "REQUIRED_MIGRATION_MISSING",
        ],
        [
          "update drizzle.__drizzle_migrations set hash='bad' where created_at=1780000000204",
          "APPLIED_MIGRATION_HASH_MISMATCH",
        ],
        [
          "update drizzle.__drizzle_migrations set hash='bad' where created_at=1780000000205",
          "APPLIED_MIGRATION_HASH_MISMATCH",
        ],
        [
          "update drizzle.__drizzle_migrations set created_at=1780000000206 where created_at=1780000000205",
          "UNKNOWN_APPLIED_MIGRATION",
        ],
        [
          "insert into drizzle.__drizzle_migrations(hash,created_at) values('unknown',1780000000206)",
          "UNKNOWN_APPLIED_MIGRATION",
        ],
        [
          "insert into drizzle.__drizzle_migrations(hash,created_at) select hash,1780000000206 from drizzle.__drizzle_migrations where created_at=1780000000205",
          "DUPLICATE_APPLIED_MIGRATION",
        ],
        [
          "insert into drizzle.__drizzle_migrations(hash,created_at) values('duplicate',1780000000205)",
          "DUPLICATE_APPLIED_MIGRATION",
        ],
        [
          "alter table public.trader_historical_preparation_event_v2 rename to dee976_missing_probe",
          "REQUIRED_V2_TABLE_MISSING",
        ],
      ];
      for (const [query, error] of probes) {
        await expect(
          upgraded.begin(async (tx) => {
            await tx.unsafe(query);
            // Entry point uses tagged SQL and unsafe only; transaction binds the same connection.
            await expect(
              assertFhvV2PostgresSchemaPreflight({ sql: tx as unknown as postgres.Sql }),
            ).rejects.toThrow(error);
            throw Error("ROLLBACK_SYNTHETIC_PROBE");
          }),
        ).rejects.toThrow("ROLLBACK_SYNTHETIC_PROBE");
        await assertFhvV2PostgresSchemaPreflight({ sql: upgraded });
      }
    });
    it("database revision fence advances on legacy revoke without changing snapshot evidence", async () => {
      const db = drizzle(upgraded, { schema });
      expect(
        (await revokeCredentialRowPostgres(db, { organizationId: org }, credential))?.status,
      ).toBe("revoked");
      expect(
        (
          await upgraded`select observation_revision from public.exchange_credentials where id=${credential}`
        )[0].observation_revision,
      ).toBe("2");
      expect(
        (
          await upgraded`select count(*) n from public.trader_balance_snapshots where id=${snapshot}`
        )[0].n,
      ).toBe("1");
    });
  },
);
