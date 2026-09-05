import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { provisionHistoricalRunnerLoginV2 } from
  "../../scripts/ops/provision-historical-runner-login.mjs";

const RUNNER = "waia_historical_runner";
const LOGIN = "waia_historical_runner_login";
const FLAGS = ["SUPERUSER", "CREATEDB", "CREATEROLE", "REPLICATION", "BYPASSRLS"] as const;
const migration = readFileSync(path.resolve(
  import.meta.dirname, "../../db/migrations_postgres/0199_historical_runner_least_privilege_v2.sql",
), "utf8");
const readTables = [...migration.match(/read_relations constant text\[\] := ARRAY\[([\s\S]*?)\];/)![1]!
  .matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]!);

// Registered by the existing CI-selected least-privilege entrypoint, not a new
// optional job. Production URLs are refused before any connection or mutation.
export function registerManagedHistoricalRoleTests(enabled: boolean, url?: string) {
  describe.skipIf(!enabled || !url)("managed PostgreSQL historical role compatibility", () => {
    let root: postgres.Sql;
    const admin = `waia_managed_probe_${randomBytes(6).toString("hex")}`;
    const password = randomBytes(32).toString("hex");
    const adminPassword = randomBytes(32).toString("hex");
    let adminUrl: string;
    let createdAdmin = false;
    let createdLogin = false;

    beforeAll(async () => {
      const parsed = new URL(url!);
      if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
        throw new Error("MANAGED_ROLE_TEST_LOCALHOST_ONLY");
      }
      root = postgres(url!, { max: 1, onnotice: () => {} });
      const identity = await root`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`;
      expect(identity[0]?.rolsuper).toBe(true); // fixture builder, NEVER the tested issuer
      expect((await root`SELECT 1 FROM pg_roles WHERE rolname=${LOGIN}`).length).toBe(0);
      await root.unsafe(`CREATE ROLE ${admin} LOGIN NOINHERIT NOSUPERUSER CREATEROLE ` +
        `PASSWORD '${adminPassword}'`);
      createdAdmin = true;
      await root.unsafe(`GRANT ${RUNNER} TO ${admin} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
      parsed.username = admin;
      parsed.password = adminPassword;
      adminUrl = parsed.toString();
    });

    afterAll(async () => {
      if (!root) return;
      if (createdLogin) await root.unsafe(`DROP ROLE ${LOGIN}`);
      if (createdAdmin) await root.unsafe(`DROP ROLE ${admin}`);
      await root.end({ timeout: 5 });
    });

    async function becomeManaged(tx: postgres.TransactionSql) {
      await tx.unsafe(`SET LOCAL ROLE ${admin}`);
      const identity = await tx`
        SELECT rolname,rolsuper,rolcreaterole,rolbypassrls,rolreplication
        FROM pg_roles WHERE rolname=current_user
      `;
      expect(identity).toEqual([{ rolname: admin, rolsuper: false, rolcreaterole: true,
        rolbypassrls: false, rolreplication: false }]);
    }

    function provisionInTransaction(tx: postgres.TransactionSql) {
      return provisionHistoricalRunnerLoginV2({
        WAIA_POSTGRES_ADMIN_SESSION_URL: url,
        WAIA_HISTORICAL_RUNNER_DB_PASSWORD: password,
      }, { openDatabase: () => ({
        begin: async (_isolation: string, work: (sql: postgres.TransactionSql) => Promise<unknown>) => {
          await becomeManaged(tx);
          return work(tx);
        },
        end: async () => {},
      }) });
    }

    it("reproduces the original 42501 even when the runner is already NOSUPERUSER", async () => {
      await expect(root.begin(async (tx) => {
        await becomeManaged(tx);
        await tx.unsafe(`ALTER ROLE ${RUNNER} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB ` +
          "NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1");
      })).rejects.toMatchObject({ code: "42501" });
    });

    it("applies the full 0199 migration as a non-superuser owner, preserving RLS and grants", async () => {
      const rollback = new Error("ROLLBACK_MANAGED_MIGRATION_PROBE");
      await expect(root.begin(async (tx) => {
        await tx.unsafe(`ALTER ROLE ${RUNNER} LOGIN INHERIT`); // pre-0199 legacy posture
        await tx.unsafe(`GRANT USAGE ON SCHEMA public,drizzle TO ${admin}`);
        await tx.unsafe(`ALTER TABLE drizzle.__drizzle_migrations OWNER TO ${admin}`);
        for (const table of readTables) {
          await tx.unsafe(`ALTER TABLE public.${table} OWNER TO ${admin}`);
        }
        await becomeManaged(tx);
        await tx.unsafe(migration).simple();
        expect(await tx`SELECT rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,
          rolreplication,rolbypassrls FROM pg_roles WHERE rolname=${RUNNER}`)
          .toEqual([{ rolcanlogin: false, rolinherit: false, rolsuper: false,
            rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
        expect(await tx`SELECT count(*)::integer AS count FROM pg_class
          WHERE relname=ANY(${readTables}) AND relrowsecurity`).toEqual([{ count: readTables.length }]);
        expect(await tx`SELECT privilege_type FROM information_schema.role_table_grants
          WHERE grantee=${RUNNER} AND privilege_type IN ('DELETE','TRUNCATE')`).toEqual([]);
        throw rollback; // later 0200–0202 grants must remain untouched for other tests
      })).rejects.toBe(rollback);
    });

    it.each(FLAGS)("migration refuses an existing %s runner, rather than demoting it", async (flag) => {
      await expect(root.begin(async (tx) => {
        await tx.unsafe(`ALTER ROLE ${RUNNER} ${flag}`);
        await becomeManaged(tx);
        await tx.unsafe(migration).simple();
      })).rejects.toThrow("migration 0199 refuses privileged");
    });

    it.each(FLAGS)("provisioning refuses a %s runner before altering it", async (flag) => {
      await expect(root.begin(async (tx) => {
        await tx.unsafe(`ALTER ROLE ${RUNNER} ${flag}`);
        await provisionInTransaction(tx);
      })).rejects.toThrow("RUNNER_PRIVILEGED");
    });

    it.each(FLAGS)("provisioning refuses a %s LOGIN before changing its password", async (flag) => {
      await expect(root.begin(async (tx) => {
        await tx.unsafe(`CREATE ROLE ${LOGIN} LOGIN ${flag}`);
        await provisionInTransaction(tx);
      })).rejects.toThrow("LOGIN_PRIVILEGED");
    });

    it.each(["ADMIN TRUE", "INHERIT TRUE", "SET FALSE"])(
      "rejects existing LOGIN membership with %s", async (option) => {
        await expect(root.begin(async (tx) => {
          await tx.unsafe(`CREATE ROLE ${LOGIN} LOGIN NOINHERIT`);
          await tx.unsafe(`GRANT ${RUNNER} TO ${LOGIN} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);
          await tx.unsafe(`GRANT ${RUNNER} TO ${LOGIN} WITH ${option}`);
          await provisionInTransaction(tx);
        })).rejects.toThrow("MEMBERSHIP_OPTIONS");
      },
    );

    it.each(["migration", "provisioner"])("%s refuses missing runner ADMIN OPTION", async (mode) => {
      await expect(root.begin(async (tx) => {
        await tx.unsafe(`ALTER ROLE ${RUNNER} LOGIN INHERIT`);
        await tx.unsafe(`REVOKE ${RUNNER} FROM ${admin}`);
        if (mode === "migration") {
          await becomeManaged(tx);
          await tx.unsafe(migration).simple();
        } else {
          await provisionInTransaction(tx);
        }
      })).rejects.toMatchObject({ code: "42501" });
      expect(await root`SELECT rolcanlogin,rolinherit FROM pg_roles WHERE rolname=${RUNNER}`)
        .toEqual([{ rolcanlogin: false, rolinherit: false }]);
      expect(await root`SELECT 1 FROM pg_roles WHERE rolname=${LOGIN}`).toEqual([]);
    });

    it("refuses missing ADMIN OPTION on an existing LOGIN and rolls back runner changes", async () => {
      await expect(root.begin(async (tx) => {
        await tx.unsafe(`ALTER ROLE ${RUNNER} LOGIN INHERIT`);
        await tx.unsafe(`CREATE ROLE ${LOGIN} LOGIN NOINHERIT`);
        await provisionInTransaction(tx);
      })).rejects.toMatchObject({ code: "42501" });
      expect(await root`SELECT rolcanlogin,rolinherit FROM pg_roles WHERE rolname=${RUNNER}`)
        .toEqual([{ rolcanlogin: false, rolinherit: false }]);
      expect(await root`SELECT 1 FROM pg_roles WHERE rolname=${LOGIN}`).toEqual([]);
    });

    it.each(["migration", "provisioner"])("%s refuses a runner with parent membership", async (mode) => {
      await expect(root.begin(async (tx) => {
        await tx.unsafe(`CREATE ROLE ${admin}_parent NOLOGIN`);
        await tx.unsafe(`GRANT ${admin}_parent TO ${RUNNER}`);
        if (mode === "migration") {
          await becomeManaged(tx);
          await tx.unsafe(migration).simple();
        } else {
          await provisionInTransaction(tx);
        }
      })).rejects.toThrow(mode === "migration" ? "inherit no roles" : "RUNNER_ROLE");
    });

    it("provisions and rotates a real SCRAM LOGIN as a managed admin; explicit SET ROLE works", async () => {
      const env = { WAIA_POSTGRES_ADMIN_SESSION_URL: adminUrl,
        WAIA_HISTORICAL_RUNNER_DB_PASSWORD: password };
      // No injected database or transaction here: the real provisioner connects
      // as a non-superuser session_user, commits and closes its own connection.
      await provisionHistoricalRunnerLoginV2(env);
      createdLogin = true;
      async function connectAndCheck(secret: string) {
        const loginUrl = new URL(url!);
        loginUrl.username = LOGIN;
        loginUrl.password = secret;
        const login = postgres(loginUrl.toString(), { max: 1, connect_timeout: 3 });
        try {
          expect(await login`SELECT session_user::text,current_user::text`)
            .toEqual([{ session_user: LOGIN, current_user: LOGIN }]);
          await expect(login`SELECT count(*) FROM public.trader_orders`)
            .rejects.toMatchObject({ code: "42501" });
          await login.unsafe(`SET ROLE ${RUNNER}`);
          expect(await login`SELECT session_user::text,current_user::text`)
            .toEqual([{ session_user: LOGIN, current_user: RUNNER }]);
          await login`SELECT count(*) FROM public.trader_orders`;
        } finally { await login.end({ timeout: 5 }); }
      }
      await connectAndCheck(password);
      const rotated = randomBytes(32).toString("hex");
      await provisionHistoricalRunnerLoginV2({ ...env,
        WAIA_HISTORICAL_RUNNER_DB_PASSWORD: rotated });
      await connectAndCheck(rotated);
      await expect(connectAndCheck(password)).rejects.toMatchObject({ code: "28P01" });
      expect(await root`SELECT m.admin_option,m.inherit_option,m.set_option
        FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=${LOGIN}`)
        .toEqual([{ admin_option: false, inherit_option: false, set_option: true }]);
    });
  });
}
