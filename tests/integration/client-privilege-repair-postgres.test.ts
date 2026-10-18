import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Root-run, explicitly gated synthetic rehearsal. No DATABASE_URL or network discovery.
const enabled = process.env.DEE1230_PG17_REHEARSAL === "1";
const database = "waia_client_privilege_fixture";
const names = ["trader_fixture_a", "trader_fixture_b"];
const roles = ["anon", "authenticated"] as const;
const contract = readFileSync("tests/fixtures/client-privilege-repair-contract.sql", "utf8");
const [helpers, apply] = contract.split("-- DEE1230_APPLY_BOUNDARY");
const rollback = new Error("EXPECTED_SYNTHETIC_ROLLBACK");
type Json = postgres.JSONValue;

describe.skipIf(!enabled)("DEE-1230 isolated PostgreSQL 17 client privilege rehearsal", () => {
  let admin: postgres.Sql;
  let bootstrap: postgres.Sql;
  let service: postgres.Sql;
  let client: postgres.Sql;
  let observer: postgres.Sql;
  let ownerPeer: postgres.Sql;
  const pools: postgres.Sql[] = [];
  const connect = (username: string) => {
    const port = Number(process.env.DEE1230_PG17_PORT);
    const ca = process.env.DEE1230_PG17_CA;
    const password = username === "postgres" ? process.env.DEE1230_PG17_PASSWORD :
      username === "dee1230_fixture_admin" ? process.env.DEE1230_PG17_BOOTSTRAP_PASSWORD : "synthetic_dee1230_fixture_only";
    if (process.env.CI || port !== 55843 || !ca || !password || !helpers || !apply)
      throw new Error("EXPLICIT_ROOT_OWNED_LOCAL_TLS_REHEARSAL_REQUIRED");
    const pool = postgres({ host: "127.0.0.1", port, database, username, password,
      max: 1, prepare: false, connect_timeout: 3, idle_timeout: ["postgres", "dee1230_fixture_admin"].includes(username) ? 0 : 2, onnotice: () => {},
      ssl: { ca: readFileSync(ca), rejectUnauthorized: true, servername: "localhost" },
      connection: { application_name: "dee1230-isolated-rehearsal", statement_timeout: 5000, lock_timeout: 1000 },
    });
    pools.push(pool); return pool;
  };
  beforeAll(async () => {
    admin = connect("postgres"); bootstrap = connect("dee1230_fixture_admin");
    const state = (await admin`SELECT current_database() AS database, session_user AS login,
      current_setting('server_version_num')::integer AS version,
      (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls,
      (SELECT rolsuper FROM pg_roles WHERE rolname=session_user) AS superuser,
      (SELECT rolbypassrls FROM pg_roles WHERE rolname=session_user) AS bypass`)[0];
    expect(state).toMatchObject({ database, login: "postgres", tls: true, superuser: false, bypass: true });
    expect(state.version).toBeGreaterThanOrEqual(170000); expect(state.version).toBeLessThan(180000);
    expect((await bootstrap`SELECT session_user AS login,
      (SELECT rolsuper FROM pg_roles WHERE rolname=session_user) AS superuser`)[0])
      .toEqual({ login: "dee1230_fixture_admin", superuser: true });
    for (const role of ["anon", "authenticated", "service_role", "dee1230_observer"]) {
      await bootstrap.unsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN
        CREATE ROLE ${role} NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB; END IF; END $$`);
    }
    await bootstrap.unsafe("ALTER ROLE service_role BYPASSRLS");
    for (const role of ["dee1230_client_login", "dee1230_observer_login", "dee1230_service_login"]) {
      const exists = await bootstrap`SELECT 1 FROM pg_roles WHERE rolname=${role}`;
      if (!exists.length) await bootstrap.unsafe(`CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`);
      // Synthetic test-only login password; the private owner password is never sent to SQL.
      await bootstrap.unsafe(`ALTER ROLE ${role} PASSWORD 'synthetic_dee1230_fixture_only'`);
    }
    await bootstrap.unsafe("GRANT anon, authenticated TO dee1230_client_login; GRANT dee1230_observer TO dee1230_observer_login; GRANT service_role TO dee1230_service_login");
    client = connect("dee1230_client_login"); observer = connect("dee1230_observer_login");
    ownerPeer = connect("postgres"); service = connect("dee1230_service_login");
  });
  afterAll(async () => { await Promise.all(pools.map(pool => pool.end({ timeout: 3 }))); });
  beforeEach(async () => {
    await bootstrap.unsafe("DROP EVENT TRIGGER IF EXISTS dee1230_injected_failure");
    await admin.unsafe(`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
      GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role,dee1230_observer;
      CREATE SCHEMA IF NOT EXISTS dee1230_client_ddl;
      GRANT USAGE,CREATE ON SCHEMA dee1230_client_ddl TO anon,authenticated;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON TABLES FROM anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON TABLES TO anon,authenticated,service_role;
      CREATE FUNCTION public.dee1230_noop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;`);
    for (const name of names) {
      await admin.unsafe(`CREATE TABLE public.${name} (id integer PRIMARY KEY, organization_id integer NOT NULL, value text);
        INSERT INTO public.${name} VALUES (1,1,'synthetic-a'),(2,2,'synthetic-b');
        ALTER TABLE public.${name} ENABLE ROW LEVEL SECURITY;
        CREATE POLICY observer_scope ON public.${name} TO dee1230_observer
          USING (organization_id=1) WITH CHECK (organization_id=1);
        GRANT SELECT,INSERT,UPDATE,DELETE ON public.${name} TO dee1230_observer;
        GRANT SELECT,INSERT,UPDATE,DELETE ON public.${name} TO service_role;`);
    }
    await admin.unsafe(helpers);
  });
  async function capture(): Promise<Json> {
    return (await admin`SELECT pg_temp.dee1230_capture(${names}::text[]) AS state`)[0].state as Json;
  }
  async function repair(before: Json, includeDefaults = true, abortAfterApply = false) {
    await admin.begin(async tx => {
      await tx.unsafe("CREATE TEMP TABLE dee1230_input(manifest jsonb) ON COMMIT DROP");
      await tx`INSERT INTO dee1230_input VALUES (${tx.json({ database, names, includeDefaults, before })})`;
      await tx.unsafe(apply);
      if (abortAfterApply) throw rollback;
    });
  }
  async function roleTx<T>(role: typeof roles[number] | "dee1230_observer" | "service_role", fn: (tx: postgres.TransactionSql) => Promise<T>) {
    return (role === "dee1230_observer" ? observer : role === "service_role" ? service : client).begin(async tx => {
      await tx.unsafe(`SET LOCAL ROLE ${role}`); return fn(tx);
    });
  }
  async function allowedThenRollback(role: typeof roles[number], statement: string) {
    await expect(roleTx(role, async tx => { await tx.unsafe(statement); throw rollback; })).rejects.toBe(rollback);
  }
  const actions = [
    ["TRUNCATE", "TRUNCATE public.trader_fixture_a"],
    ["REFERENCES", "CREATE TABLE dee1230_client_ddl.child (id integer REFERENCES public.trader_fixture_a(id))"],
    ["TRIGGER", "CREATE TRIGGER client_probe BEFORE INSERT ON public.trader_fixture_a FOR EACH ROW EXECUTE FUNCTION public.dee1230_noop()"],
    ["MAINTAIN", "REINDEX TABLE public.trader_fixture_a"],
  ] as const;

  it.each(roles)("removes all four real client operations for %s while retaining seeded rows", async role => {
    for (const [, statement] of actions) await allowedThenRollback(role, statement);
    const before = await capture(); await repair(before);
    for (const [, statement] of actions) await expect(roleTx(role, tx => tx.unsafe(statement))).rejects.toMatchObject({ code: "42501" });
    expect(await admin`SELECT id,value FROM public.trader_fixture_a ORDER BY id`)
      .toEqual([{ id: 1, value: "synthetic-a" }, { id: 2, value: "synthetic-b" }]);
  });

  it("preserves owner/server ACLs, role graph, column ACLs, policies, triggers and exact clean idempotence", async () => {
    await admin.unsafe("GRANT SELECT(value) ON public.trader_fixture_a TO dee1230_observer");
    const before = await capture();
    const expected = (await admin`SELECT pg_temp.dee1230_clean(${admin.json(before)},true) AS state`)[0].state;
    await repair(before); expect(await capture()).toEqual(expected);
    await repair(before); expect(await capture()).toEqual(expected);
    const rights = await admin`SELECT has_table_privilege('postgres','public.trader_fixture_a','TRUNCATE') AS owner,
      has_table_privilege('service_role','public.trader_fixture_a','MAINTAIN') AS service`;
    expect(rights[0]).toEqual({ owner: true, service: true });
  });

  it("preserves actual observer CRUD and organization restriction", async () => {
    await repair(await capture());
    await roleTx("dee1230_observer", async tx => {
      expect(await tx`SELECT id FROM public.trader_fixture_a ORDER BY id`).toEqual([{ id: 1 }]);
      await tx`INSERT INTO public.trader_fixture_a VALUES (3,1,'created')`;
      await tx`UPDATE public.trader_fixture_a SET value='updated' WHERE id=3`;
      expect((await tx`SELECT value FROM public.trader_fixture_a WHERE id=3`)[0].value).toBe("updated");
      await tx`DELETE FROM public.trader_fixture_a WHERE id=3`;
    });
    await expect(roleTx("dee1230_observer", tx => tx`INSERT INTO public.trader_fixture_a VALUES (4,2,'foreign')`)).rejects.toMatchObject({ code: "42501" });
  });


  it("does not block an ordinary concurrent owner row update with target identity locks", async () => {
    const before = await capture();
    await expect(ownerPeer.begin(async tx => {
      await tx`UPDATE public.trader_fixture_a SET value='concurrent-synthetic' WHERE id=1`;
      await repair(before);
      throw rollback;
    })).rejects.toBe(rollback);
    expect((await admin`SELECT value FROM public.trader_fixture_a WHERE id=1`)[0].value).toBe("synthetic-a");
  });


  it("preserves real BYPASSRLS service-role CRUD after the repair", async () => {
    await repair(await capture());
    await roleTx("service_role", async tx => {
      expect((await tx`SELECT count(*)::integer AS n FROM public.trader_fixture_a`)[0].n).toBe(2);
      await tx`INSERT INTO public.trader_fixture_a VALUES (5,2,'server-created')`;
      await tx`UPDATE public.trader_fixture_a SET value='server-updated' WHERE id=5`;
      expect((await tx`SELECT value FROM public.trader_fixture_a WHERE id=5`)[0].value).toBe("server-updated");
      await tx`DELETE FROM public.trader_fixture_a WHERE id=5`;
    });
  });

  it("removes only admitted postgres public future-table client defaults", async () => {
    await repair(await capture());
    await admin.unsafe("CREATE TABLE public.trader_future (id integer)");
    const result = await admin`SELECT has_table_privilege('anon','public.trader_future','TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS anon,
      has_table_privilege('authenticated','public.trader_future','TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS authenticated,
      has_table_privilege('service_role','public.trader_future','TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS service,
      has_table_privilege('postgres','public.trader_future','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS owner`;
    expect(result[0]).toEqual({ anon: false, authenticated: false, service: true, owner: true });
  });

  it("can rehearse the current-table-only delta while keeping defaults unchanged", async () => {
    const before = await capture(); await repair(before, false);
    expect((await capture() as Record<string, Json>).defaults).toEqual((before as Record<string, Json>).defaults);
  });

  it("refuses an admitted default snapshot with a PUBLIC privilege path", async () => {
    await admin.unsafe("ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRUNCATE ON TABLES TO PUBLIC");
    const before = await capture();
    await expect(repair(before)).rejects.toMatchObject({ code: "P0001" });
    expect(await capture()).toEqual(before);
  });

  it.each([
    ["mixed", "REVOKE TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON public.trader_fixture_a FROM anon,authenticated"],
    ["extra client ACL", "GRANT SELECT ON public.trader_fixture_a TO anon"],
    ["column ACL", "GRANT SELECT(value) ON public.trader_fixture_a TO anon"],
    ["owner", "ALTER TABLE public.trader_fixture_a OWNER TO service_role"],
    ["global default", "ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT TRUNCATE ON TABLES TO anon"],
    ["RLS", "ALTER TABLE public.trader_fixture_a DISABLE ROW LEVEL SECURITY"],
  ])("refuses %s drift without further mutation", async (label, mutation) => {
    const before = await capture();
    // Owner drift is injected only by fixture bootstrap, never by the repair owner.
    await (label === "owner" ? bootstrap : admin).unsafe(mutation);
    const drift = await capture();
    await expect(repair(before)).rejects.toMatchObject({ code: label === "owner" ? "42501" : "P0001" }); expect(await capture()).toEqual(drift);
  });


  it.each(["duplicate-table", "missing-table-grantor", "duplicate-default", "missing-default-grantable", "extra-table-missing-grantee"])(
    "refuses malformed expected-before client ACLs even on a clean state: %s", async variation => {
      const before = await capture(); await repair(before); const clean = await capture();
      const malformed = JSON.parse(JSON.stringify(before));
      const entries = variation.includes("table") ? malformed.tables[0].acl :
        malformed.defaults.find((entry: { creator: string; schema: string }) => entry.creator === "postgres" && entry.schema === "public").acl;
      if (variation.startsWith("extra")) entries.push({ privilege: "TRUNCATE", grantor: "postgres", grantable: false });
      else for (const entry of entries) if (entry.grantee === "anon") {
        if (variation.startsWith("duplicate")) entry.privilege = "TRUNCATE";
        else if (variation.endsWith("grantor")) delete entry.grantor;
        else delete entry.grantable;
      }
      await expect(repair(malformed)).rejects.toMatchObject({ code: "P0001" });
      expect(await capture()).toEqual(clean);
    });


  it("rolls back table ACLs and changed defaults after a post-apply transaction failure", async () => {
    const before = await capture();
    await expect(repair(before, true, true)).rejects.toBe(rollback);
    expect(await capture()).toEqual(before);
  });

  it("rolls back the first target revoke when an event trigger fails the second target", async () => {
    await bootstrap.unsafe(`CREATE TABLE public.dee1230_fault (n integer); INSERT INTO public.dee1230_fault VALUES (0);
      CREATE FUNCTION public.dee1230_injected_failure() RETURNS event_trigger LANGUAGE plpgsql AS $$ DECLARE step integer; BEGIN
        IF tg_tag='REVOKE' THEN UPDATE public.dee1230_fault SET n=n+1 RETURNING n INTO step;
          IF step=2 THEN RAISE EXCEPTION 'SYNTHETIC_MID_TRANSACTION_FAILURE'; END IF; END IF; END $$;
      GRANT SELECT,UPDATE ON public.dee1230_fault TO postgres;
      CREATE EVENT TRIGGER dee1230_injected_failure ON ddl_command_end WHEN TAG IN ('REVOKE')
        EXECUTE FUNCTION public.dee1230_injected_failure();`);
    const before = await capture();
    await expect(repair(before)).rejects.toThrow("SYNTHETIC_MID_TRANSACTION_FAILURE");
    expect(await capture()).toEqual(before);
    expect((await admin`SELECT n FROM public.dee1230_fault`)[0].n).toBe(0);
    expect((await admin`SELECT count(*)::integer AS n FROM public.trader_fixture_a`)[0].n).toBe(2);
  });
});
