import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres, { type Sql } from "postgres";

const enabled = process.env.DEE960_LOCAL_PG17 === "1";
const requestedPort = process.env.DEE960_LOCAL_PG17_PORT ?? "55463";
if (enabled && requestedPort !== "55463") {
  throw new Error("DEE960_LOCAL_PG17_PORT must use the dedicated inventory role test port 55463");
}
const localPort = "55463";
const rootUrl = `postgres://waia_local_admin:local_validation_only@127.0.0.1:${localPort}/postgres`;
const migration = readFileSync(
  "db/migrations_postgres/0231_trader_account_observation_spot_inventory_v1.sql",
  "utf8",
);
const statements = migration.split("--> statement-breakpoint").filter((part) => part.trim()).slice(1);
type Membership = {
  grantor: string;
  admin_option: boolean;
  inherit_option: boolean;
  set_option: boolean;
};

describe.skipIf(!enabled)("0231 native PostgreSQL role membership preservation", () => {
  const rootConnections: Sql[] = [];
  const targetConnections: Sql[] = [];
  const databases: string[] = [];
  const roles: string[] = [];

  afterAll(async () => {
    for (const sql of targetConnections) await sql.end({ timeout: 2 });
    const root = postgres(rootUrl, { max: 1, connect_timeout: 3, prepare: false, onnotice: () => {} });
    try {
      for (const database of databases) {
        await root.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      }
      for (const role of roles) await root.unsafe(`DROP ROLE IF EXISTS "${role}"`);
    } finally {
      await root.end({ timeout: 2 });
      await Promise.all(rootConnections.map((sql) => sql.end({ timeout: 2 })));
    }
  });

  beforeEach(async () => {
    if (roles.length === 0) return;
    const admin = await root();
    for (const role of roles) {
      await admin.unsafe(`REVOKE waia_account_observation_inventory_owner FROM "${role}" CASCADE`);
    }
  });

  async function root() {
    const sql = postgres(rootUrl, { max: 1, connect_timeout: 3, prepare: false, onnotice: () => {} });
    rootConnections.push(sql);
    const version = Number((await sql`SHOW server_version_num`)[0].server_version_num);
    expect(version).toBeGreaterThanOrEqual(170000);
    expect(version).toBeLessThan(180000);
    return sql;
  }

  async function target(role: string) {
    const admin = await root();
    const database = `dee1032_rolefix_${randomUUID().replaceAll("-", "")}`;
    databases.push(database);
    if (!roles.includes(role)) {
      await admin.unsafe(`CREATE ROLE "${role}" LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB CREATEROLE
        PASSWORD 'synthetic_rolefix_only'`);
      roles.push(role);
    }
    await admin.unsafe(`CREATE DATABASE "${database}"`);
    await admin.unsafe(`GRANT CONNECT, CREATE ON DATABASE "${database}" TO "${role}"`);
    const adminDbUrl = rootUrl.replace("/postgres", `/${database}`);
    const adminDb = postgres(adminDbUrl, { max: 1, connect_timeout: 3, prepare: false, onnotice: () => {} });
    targetConnections.push(adminDb);
    const url = `postgres://${role}:synthetic_rolefix_only@127.0.0.1:${localPort}/${database}`;
    const sql = postgres(url, { max: 1, connect_timeout: 3, prepare: false, onnotice: () => {} });
    targetConnections.push(sql);
    await adminDb.unsafe(`GRANT USAGE, CREATE ON SCHEMA public TO "${role}" WITH GRANT OPTION`);
    const identity = await sql`SELECT session_user::text AS session_user, current_user::text AS current_user`;
    expect(identity).toEqual([{ session_user: role, current_user: role }]);
    await sql.begin(async (tx) => {
      await tx.unsafe(`CREATE TABLE public.exchange_credentials (
        id uuid PRIMARY KEY, organization_id uuid NOT NULL, venue text NOT NULL,
        exchange_account_id text NOT NULL, status text NOT NULL,
        observation_revision bigint NOT NULL, encrypted_payload text)`);
      await tx.unsafe(`CREATE TABLE public.trader_account_collection_state (
        organization_id uuid NOT NULL, credential_id uuid NOT NULL,
        exchange_account_id text NOT NULL, configuration_revision text NOT NULL,
        symbols jsonb NOT NULL, last_observation_id uuid,
        PRIMARY KEY (organization_id, credential_id, exchange_account_id))`);
    });
    return { admin, adminDb, sql, database };
  }

  async function apply(sql: Sql, role: string, fromStatement = 0) {
    expect(await sql`SELECT session_user::text AS session_user, current_user::text AS current_user`)
      .toEqual([{ session_user: role, current_user: role }]);
    await sql.begin(async (tx) => {
      for (const statement of statements.slice(fromStatement)) await tx.unsafe(statement);
    });
  }

  async function membership(sql: Sql, role: string): Promise<Membership[]> {
    return sql<Membership[]>`
      SELECT grantor.rolname AS grantor, membership.admin_option,
        membership.inherit_option, membership.set_option
      FROM pg_auth_members membership
      JOIN pg_roles member ON member.oid = membership.member
      JOIN pg_roles owner ON owner.oid = membership.roleid
      JOIN pg_roles grantor ON grantor.oid = membership.grantor
      WHERE member.rolname = ${role}
        AND owner.rolname = 'waia_account_observation_inventory_owner'
      ORDER BY grantor.rolname`;
  }

  async function ownerMembers(sql: Sql) {
    return sql`
      SELECT member.rolname AS member, grantor.rolname AS grantor,
        membership.admin_option, membership.inherit_option, membership.set_option
      FROM pg_auth_members membership
      JOIN pg_roles member ON member.oid = membership.member
      JOIN pg_roles owner ON owner.oid = membership.roleid
      JOIN pg_roles grantor ON grantor.oid = membership.grantor
      WHERE owner.rolname = 'waia_account_observation_inventory_owner'
      ORDER BY member.rolname, grantor.rolname`;
  }

  async function observerInventoryMembership(sql: Sql) {
    return sql`
      SELECT grantor.rolname AS grantor, membership.admin_option,
        membership.inherit_option, membership.set_option
      FROM pg_auth_members membership
      JOIN pg_roles member ON member.oid = membership.member
      JOIN pg_roles parent ON parent.oid = membership.roleid
      JOIN pg_roles grantor ON grantor.oid = membership.grantor
      WHERE member.rolname = 'waia_account_observer_login'
        AND parent.rolname = 'waia_account_observation_inventory'
      ORDER BY grantor.rolname`;
  }

  it("cleans its temporary SET grant, preserves implicit ADMIN-only membership, and replays in a second database", async () => {
    const role = `dee1032_creator_${randomUUID().replaceAll("-", "")}`;
    const first = await target(role);
    // Apply the first DO only to create the owner role under the limited
    // CREATEROLE identity, then seed a same-grantor non-SET edge to verify
    // that the temporary SET grant restores all pre-existing options.
    await first.sql.begin(async (tx) => {
      await tx.unsafe(statements[0]);
    });
    await first.admin.unsafe(`GRANT waia_account_observation_inventory_owner TO "${role}"
      WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
    await first.sql.unsafe(`GRANT waia_account_observation_inventory_owner TO "${role}"
      WITH ADMIN FALSE, INHERIT TRUE, SET FALSE GRANTED BY "${role}"`);
    const beforeFirstMigration = await membership(first.admin, role);
    expect(beforeFirstMigration).toEqual([
      { grantor: role, admin_option: false, inherit_option: true, set_option: false },
      { grantor: "waia_local_admin", admin_option: true, inherit_option: false, set_option: false },
    ]);
    await apply(first.sql, role, 1);

    const afterFirst = await membership(first.admin, role);
    expect(afterFirst).toEqual(beforeFirstMigration);
    expect(await first.admin`SELECT pg_has_role(${role},
      'waia_account_observation_inventory_owner','SET') AS can_set`).toEqual([{ can_set: false }]);

    await first.sql.begin(async (tx) => {
      await tx`INSERT INTO public.exchange_credentials
        (id,organization_id,venue,exchange_account_id,status,observation_revision,encrypted_payload)
        VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a',
          'htx','acct-a','active',1,'synthetic')`;
      await tx`INSERT INTO public.trader_account_collection_state
        (organization_id,credential_id,exchange_account_id,configuration_revision,symbols)
        VALUES
          ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000001','acct-a','cfg','["BTCUSDT"]'),
          ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-000000000001','acct-a','cfg','["BTCUSDT"]'),
          ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000001','acct-b','cfg','["BTCUSDT"]')`;
      await tx.unsafe("ALTER TABLE public.exchange_credentials ENABLE ROW LEVEL SECURITY");
      await tx.unsafe("ALTER TABLE public.exchange_credentials FORCE ROW LEVEL SECURITY");
      await tx.unsafe("ALTER TABLE public.trader_account_collection_state ENABLE ROW LEVEL SECURITY");
      await tx.unsafe("ALTER TABLE public.trader_account_collection_state FORCE ROW LEVEL SECURITY");
    });
    await first.adminDb.unsafe("SET ROLE waia_account_observation_inventory_owner");
    const visibleState = await first.adminDb`
      SELECT organization_id::text, credential_id::text, exchange_account_id
      FROM public.trader_account_collection_state ORDER BY exchange_account_id`;
    await first.adminDb.unsafe("RESET ROLE");
    expect(visibleState).toEqual([{
      organization_id: "00000000-0000-0000-0000-00000000000a",
      credential_id: "00000000-0000-0000-0000-000000000001",
      exchange_account_id: "acct-a",
    }]);

    const second = await target(role);
    await apply(second.sql, role);
    expect(await membership(second.admin, role)).toEqual(afterFirst);
    expect(await second.admin`SELECT pg_has_role(${role},
      'waia_account_observation_inventory_owner','SET') AS can_set`).toEqual([{ can_set: false }]);
  }, 60000);

  it("refuses a pre-created owner role without direct ADMIN authority before schema changes", async () => {
    const role = `dee1032_noauth_${randomUUID().replaceAll("-", "")}`;
    const { admin, adminDb, sql } = await target(role);
    const before = await membership(admin, role);
    expect(before).toEqual([]);
    let failure: unknown;
    try {
      await apply(sql, role);
    } catch (cause) {
      failure = cause;
    }
    expect(String(failure)).toContain("ACCOUNT_OBSERVATION_INVENTORY_OWNER_ADMIN_REQUIRED");
    expect(await membership(admin, role)).toEqual(before);
    expect(await adminDb`SELECT has_schema_privilege(
      'waia_account_observation_inventory_owner','public','CREATE') AS can_create`).toEqual([
      { can_create: false },
    ]);
    expect(await sql`SELECT count(*)::int AS count FROM pg_policies
      WHERE schemaname='public' AND policyname LIKE 'trader_observation_inventory_%'`).toEqual([
      { count: 0 },
    ]);
  }, 60000);

  it("refuses unexpected owner grantees with SET or ADMIN before installing schema objects", async () => {
    const role = `dee1032_owner_collision_${randomUUID().replaceAll("-", "")}`;
    const { admin, adminDb, sql } = await target(role);
    await sql.begin(async (tx) => { await tx.unsafe(statements[0]); });
    const setGrantee = `dee1032_owner_set_${randomUUID().replaceAll("-", "")}`;
    const adminGrantee = `dee1032_owner_admin_${randomUUID().replaceAll("-", "")}`;
    for (const grantee of [setGrantee, adminGrantee]) {
      await admin.unsafe(`CREATE ROLE "${grantee}" LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS`);
      roles.push(grantee);
    }
    await admin.unsafe(`GRANT waia_account_observation_inventory_owner TO "${setGrantee}"
      WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);
    await admin.unsafe(`GRANT waia_account_observation_inventory_owner TO "${adminGrantee}"
      WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
    const before = await ownerMembers(admin);
    expect(before.map((edge) => edge.member)).toEqual([setGrantee, adminGrantee].sort());
    const actorMembershipBefore = await membership(admin, role);

    await expect(sql.unsafe(statements[1])).rejects.toThrow(
      "ACCOUNT_OBSERVATION_INVENTORY_OWNER_MEMBER_UNSAFE",
    );
    expect(await ownerMembers(admin)).toEqual(before);
    expect(await membership(admin, role)).toEqual(actorMembershipBefore);
    expect(await adminDb`SELECT has_schema_privilege(
      'waia_account_observation_inventory_owner','public','CREATE') AS can_create`).toEqual([
      { can_create: false },
    ]);
    expect(await sql`SELECT count(*)::int AS count FROM pg_policies
      WHERE schemaname='public' AND policyname LIKE 'trader_observation_inventory_%'`).toEqual([
      { count: 0 },
    ]);
    expect(await sql`SELECT to_regprocedure(
      'public.trader_account_observation_spot_inventory(text,jsonb)') IS NULL AS absent`).toEqual([
      { absent: true },
    ]);
  }, 60000);

  it("requires direct ADMIN provenance for the pre-created execute-only role when its LOGIN exists", async () => {
    const role = `dee1032_no_caller_admin_${randomUUID().replaceAll("-", "")}`;
    const { admin, adminDb, sql } = await target(role);
    await admin.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='waia_account_observer_login') THEN
        CREATE ROLE waia_account_observer_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
          NOCREATEDB NOCREATEROLE PASSWORD 'synthetic_observer_only';
      END IF;
    END $$`);
    if (!roles.includes("waia_account_observer_login")) roles.push("waia_account_observer_login");
    await admin.unsafe(`GRANT waia_account_observation_inventory_owner TO "${role}"
      WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
    const before = await membership(admin, role);
    expect(before).toEqual([
      { grantor: "waia_local_admin", admin_option: true, inherit_option: false, set_option: false },
    ]);
    let failure: unknown;
    try {
      await apply(sql, role);
    } catch (cause) {
      failure = cause;
    }
    expect(String(failure)).toContain("ACCOUNT_OBSERVATION_INVENTORY_CALLER_ADMIN_REQUIRED");
    expect(await membership(admin, role)).toEqual(before);
    expect(await adminDb`SELECT has_schema_privilege(
      'waia_account_observation_inventory_owner','public','CREATE') AS can_create`).toEqual([
      { can_create: false },
    ]);
    expect(await sql`SELECT count(*)::int AS count FROM pg_policies
      WHERE schemaname='public' AND policyname LIKE 'trader_observation_inventory_%'`).toEqual([
      { count: 0 },
    ]);
  }, 60000);

  it("refuses unsafe pre-existing observer LOGIN inventory grants before schema changes", async () => {
    const role = `dee1032_unsafe_login_${randomUUID().replaceAll("-", "")}`;
    const { admin, adminDb, sql } = await target(role);
    await sql.begin(async (tx) => {
      await tx.unsafe(statements[0]);
    });
    await admin.unsafe(`GRANT waia_account_observation_inventory_owner TO "${role}"
      WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
    await admin.unsafe(`GRANT waia_account_observation_inventory TO "${role}"
      WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
    await admin.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='waia_account_observer_login') THEN
        CREATE ROLE waia_account_observer_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
          NOCREATEDB NOCREATEROLE PASSWORD 'synthetic_observer_only';
      END IF;
    END $$`);
    if (!roles.includes("waia_account_observer_login")) roles.push("waia_account_observer_login");
    await admin.unsafe(`GRANT waia_account_observation_inventory TO waia_account_observer_login
      WITH ADMIN TRUE, INHERIT TRUE, SET TRUE`);
    const before = await observerInventoryMembership(admin);
    expect(before).toEqual([
      { grantor: "waia_local_admin", admin_option: true, inherit_option: true, set_option: true },
    ]);
    try {
      let failure: unknown;
      try {
        await apply(sql, role);
      } catch (cause) {
        failure = cause;
      }
      expect(String(failure)).toContain("ACCOUNT_OBSERVATION_INVENTORY_LOGIN_MEMBERSHIP_UNSAFE");
      expect(await observerInventoryMembership(admin)).toEqual(before);
      expect(await adminDb`SELECT has_schema_privilege(
        'waia_account_observation_inventory_owner','public','CREATE') AS can_create`).toEqual([
        { can_create: false },
      ]);
      expect(await sql`SELECT count(*)::int AS count FROM pg_policies
        WHERE schemaname='public' AND policyname LIKE 'trader_observation_inventory_%'`).toEqual([
        { count: 0 },
      ]);
    } finally {
      await admin.unsafe(`REVOKE waia_account_observation_inventory FROM waia_account_observer_login`);
    }
  }, 60000);

  it("allows a superuser installer with an existing observer LOGIN", async () => {
    const role = `dee1032_superuser_${randomUUID().replaceAll("-", "")}`;
    const { admin, adminDb } = await target(role);
    await admin.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='waia_account_observer_login') THEN
        CREATE ROLE waia_account_observer_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
          NOCREATEDB NOCREATEROLE PASSWORD 'synthetic_observer_only';
      END IF;
    END $$`);
    if (!roles.includes("waia_account_observer_login")) roles.push("waia_account_observer_login");

    await apply(adminDb, "waia_local_admin");

    expect(await adminDb`
      SELECT pg_has_role('waia_account_observer_login',
        'waia_account_observation_inventory', 'SET') AS can_set_executor,
        pg_has_role('waia_account_observer_login',
          'waia_account_observation_inventory_owner', 'SET') AS can_set_owner,
        has_function_privilege('waia_account_observation_inventory', function.oid, 'EXECUTE') AS executor_can_execute
      FROM pg_proc function
      JOIN pg_namespace schema ON schema.oid = function.pronamespace
      WHERE schema.nspname = 'public'
        AND function.proname = 'trader_account_observation_spot_inventory'
        AND function.pronargs = 2`)
      .toEqual([{ can_set_executor: true, can_set_owner: false, executor_can_execute: true }]);
    expect(await adminDb`
      SELECT count(*)::int AS safe_private_roles
      FROM pg_roles
      WHERE rolname IN ('waia_account_observation_inventory_owner','waia_account_observation_inventory')
        AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole
        AND NOT rolinherit`).toEqual([{ safe_private_roles: 2 }]);
  }, 60000);

  it("refuses the execute-only caller when it can SET an owner or privileged parent role", async () => {
    for (const parentRole of ["waia_account_observation_inventory_owner", "waia_account_observer"]) {
      const role = `dee1032_topology_${randomUUID().replaceAll("-", "")}`;
      const { admin, adminDb, sql } = await target(role);
      if (parentRole === "waia_account_observer") {
        await admin.unsafe(`DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='waia_account_observer') THEN
            CREATE ROLE waia_account_observer NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
          END IF;
        END $$`);
      }
      await admin.unsafe(`GRANT "${parentRole}" TO waia_account_observation_inventory
        WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);
      try {
        await expect(apply(sql, role, 0)).rejects.toThrow("UNSAFE_OBSERVATION_INVENTORY_ROLE");
        expect(await adminDb`SELECT has_schema_privilege(
          'waia_account_observation_inventory_owner','public','CREATE') AS can_create`).toEqual([
          { can_create: false },
        ]);
        expect(await sql`SELECT count(*)::int AS count FROM pg_policies
          WHERE schemaname='public' AND policyname LIKE 'trader_observation_inventory_%'`).toEqual([
          { count: 0 },
        ]);
      } finally {
        await admin.unsafe(`REVOKE "${parentRole}" FROM waia_account_observation_inventory`);
      }
    }
  }, 60000);

  it("preserves a pre-existing SET-only membership and its exact grantor options", async () => {
    const role = `dee1032_setonly_${randomUUID().replaceAll("-", "")}`;
    const { admin, sql } = await target(role);
    // Create the private roles before attaching the executor's exact ADMIN
    // provenance. The observer LOGIN persists across cases in this isolated
    // cluster, so this successful path must satisfy the caller preflight too.
    await sql.begin(async (tx) => {
      await tx.unsafe(statements[0]);
    });
    await admin.unsafe(`GRANT waia_account_observation_inventory TO "${role}"
      WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
    await admin.unsafe(`GRANT waia_account_observation_inventory_owner TO "${role}"
      WITH ADMIN FALSE, INHERIT TRUE, SET TRUE`);
    const before = await membership(admin, role);
    expect(before).toEqual([
      { grantor: "waia_local_admin", admin_option: false, inherit_option: true, set_option: true },
    ]);
    await apply(sql, role, 1);
    expect(await membership(admin, role)).toEqual(before);
  }, 60000);
});
