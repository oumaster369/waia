import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres, { type Sql } from "postgres";
import { createPostgresObservationReader } from "@/lib/trader/account-observation/postgres-reader";
import { createPostgresObservationAssignmentSource } from "@/lib/trader/account-observation/postgres-assignments";
import { createObservationConfiguration } from "@/lib/trader/account-observation/runtime";
import type { AccountObservation, ObservationBinding } from "@/lib/trader/account-observation/types";
import { observationPoolLimits, probeObservationPool } from "@/lib/trader/account-observation/host-role-probe";
import { createAccountObservationHost } from "@/lib/trader/account-observation/host";
import { accountObservationClock } from "@/lib/trader/account-observation/clock";

// Explicit synthetic loopback-only target; never use production environment URLs.
const enabled = process.env.DEE960_LOCAL_PG17 === "1";
const url = "postgres://waia_local_admin:local_validation_only@127.0.0.1:55460/waia_dee960_local";
describe.skipIf(!enabled)("DEE-960 dedicated read-only LOGIN on actual PostgreSQL 17", () => {
  let root: Sql; let admin: Sql; let client: Sql;
  let reader: ReturnType<typeof createPostgresObservationReader>;
  let login: string;
  beforeAll(async () => {
    root = postgres(url, { max: 1, connect_timeout: 3, prepare: false });
    const version = Number((await root`SHOW server_version_num`)[0].server_version_num);
    expect(version).toBeGreaterThanOrEqual(170000); expect(version).toBeLessThan(180000);
    const suffix = randomUUID().replaceAll("-", "");
    const db = "dee960_read_" + suffix; login = "dee960_read_" + suffix;
    await root.unsafe(`CREATE DATABASE "${db}"`);
    admin = postgres(url.replace("/waia_dee960_local", "/" + db), { max: 3, connect_timeout: 3, prepare: false });
    await admin.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dee960_local_owner') THEN
        CREATE ROLE dee960_local_owner NOLOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    END $$;
    GRANT USAGE, CREATE ON SCHEMA public TO dee960_local_owner WITH GRANT OPTION;`);
    await admin.begin(async tx => {
      await tx.unsafe("SET LOCAL ROLE dee960_local_owner");
      await tx.unsafe("CREATE TABLE public.organizations (id uuid PRIMARY KEY)");
      for (const path of ["db/migrations_postgres/0006_exchange_credentials.sql",
        "db/migrations_postgres/0007_exchange_credentials_rls.sql", "db/local-validation/dee960-account-observation.sql"])
        await tx.unsafe(readFileSync(path, "utf8").replaceAll("--> statement-breakpoint", ""));
    });
    await admin.unsafe(`CREATE ROLE "${login}" LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
      PASSWORD 'synthetic_reader_local_only';
      GRANT waia_account_observation_reader TO "${login}" WITH INHERIT FALSE, SET TRUE;
      GRANT CONNECT ON DATABASE "${db}" TO "${login}";`);
    client = postgres(`postgres://${login}:synthetic_reader_local_only@127.0.0.1:55460/${db}`,
      { max: 2, connect_timeout: 3, max_lifetime: 60, prepare: false });
    reader = createPostgresObservationReader(client);
  }, 30000);
  afterAll(async () => {
    await client?.end({ timeout: 2 }); await admin?.end({ timeout: 2 }); await root?.end({ timeout: 2 });
    // Isolated synthetic DB/role retained for diagnosis; no destructive cleanup of user data.
  });
  function scope(b: ObservationBinding) {
    return { organizationId: b.organizationId, credentialId: b.credentialId, exchangeAccountId: b.exchangeAccountId };
  }
  async function seed(mutate?: (o: AccountObservation) => unknown) {
    const b: ObservationBinding = { organizationId: randomUUID(), credentialId: randomUUID(),
      exchangeAccountId: randomUUID(), credentialRevision: "1", configurationRevision: "config-1" };
    const t = Date.now();
    const component = { status: "COMPLETE" as const, values: [], sourceAsOfMs: null,
      readStartedAtMs: t, readCompletedAtMs: t, error: null };
    const observation: AccountObservation = { schemaVersion: "account-observation/v1", observationId: randomUUID(), binding: b,
      collectionStartedAtMs: t, collectionCompletedAtMs: t, status: "COMPLETE", balances: component,
      openOrders: component, trades: [{ symbol: "BTCUSDT", component }], holdings: [] };
    await admin`INSERT INTO public.organizations VALUES (${b.organizationId})`;
    await admin`INSERT INTO public.exchange_credentials (id, organization_id, venue, exchange_account_id, encrypted_payload)
      VALUES (${b.credentialId}, ${b.organizationId}, 'htx', ${b.exchangeAccountId}, 'synthetic-no-key')`;
    await admin`INSERT INTO public.trader_account_collection_state
      (organization_id, credential_id, exchange_account_id, configuration_revision, symbols)
      VALUES (${b.organizationId}, ${b.credentialId}, ${b.exchangeAccountId}, 'config-1', '["BTCUSDT"]')`;
    const payload = mutate ? mutate(observation) : observation;
    await admin`INSERT INTO public.trader_account_observations
      (organization_id, credential_id, exchange_account_id, observation_id, credential_revision, configuration_revision, lease_token, payload)
      VALUES (${b.organizationId}, ${b.credentialId}, ${b.exchangeAccountId}, ${observation.observationId},
        1, 'config-1', ${randomUUID()}, ${admin.json(JSON.parse(JSON.stringify(payload)))})`;
    await admin`UPDATE public.trader_account_collection_state SET last_observation_id=${observation.observationId}
      WHERE credential_id=${b.credentialId}`;
    return { b, observation };
  }
  async function restricted(b: ObservationBinding, statement: string) {
    return client.begin(async tx => {
      await tx.unsafe("SET LOCAL ROLE waia_account_observation_reader");
      await tx`SELECT set_config('waia.observation_org', ${b.organizationId}, true),
        set_config('waia.observation_credential', ${b.credentialId}, true),
        set_config('waia.observation_account', ${b.exchangeAccountId}, true)`;
      return tx.unsafe(statement);
    });
  }
  it("resolves exact active binding and reads the same immutable observation", async () => {
    const { b, observation } = await seed();
    expect(await reader.resolveActiveBinding(scope(b))).toEqual(b);
    expect(await reader.resolveActiveBinding(b)).toEqual(b);
    expect(await reader.readLatest(b)).toEqual(observation);
  });
  it("checks exact current assignment and configured symbols through the restricted reader", async () => {
    const { b } = await seed();
    expect(await reader.isCurrentAssignment(b, ["BTCUSDT"])).toBe(true);
    expect(await reader.isCurrentAssignment(b, ["ETHUSDT"])).toBe(false);
    expect(await reader.isCurrentAssignment({ ...b, organizationId: randomUUID() }, ["BTCUSDT"])).toBe(false);
    expect(await reader.isCurrentAssignment({ ...b, credentialRevision: "2" }, ["BTCUSDT"])).toBe(false);
    expect(await reader.isCurrentAssignment({ ...b, configurationRevision: "wrong" }, ["BTCUSDT"])).toBe(false);
    await admin`UPDATE public.exchange_credentials SET status='revoked' WHERE id=${b.credentialId}`;
    expect(await reader.isCurrentAssignment(b, ["BTCUSDT"])).toBe(false);
  });
  it("DB-backed assignment source refuses rotation, symbol drift and revoke without adopting them", async () => {
    const config = createObservationConfiguration({ symbols: ["BTCUSDT"], pollIntervalMs: 1000,
      maxBackoffMs: 8000, readTimeoutMs: 100, leaseTtlMs: 1000 });
    const { b } = await seed(); const binding = { ...b, configurationRevision: config.revision };
    await admin`UPDATE public.trader_account_collection_state SET configuration_revision=${config.revision} WHERE credential_id=${b.credentialId}`;
    const source = createPostgresObservationAssignmentSource(client, [{ binding, config }]);
    const signal = new AbortController().signal;
    expect(await source.loadAssignments(signal)).toEqual([{ binding, config }]);
    expect(await source.authorizeOpen(binding, signal)).toBe(true);
    await admin`UPDATE public.trader_account_collection_state SET symbols='["ETHUSDT"]' WHERE credential_id=${b.credentialId}`;
    expect(await source.authorizeOpen(binding, signal)).toBe(false);
    await admin`UPDATE public.trader_account_collection_state SET symbols='["BTCUSDT"]' WHERE credential_id=${b.credentialId}`;
    await admin`UPDATE public.exchange_credentials SET permission_metadata='synthetic-revision-change' WHERE id=${b.credentialId}`;
    expect(await source.loadAssignments(signal)).toEqual([]);
    expect(await source.authorizeOpen({ ...binding, credentialRevision: "2" }, signal)).toBe(false);
    await admin`UPDATE public.exchange_credentials SET status='revoked' WHERE id=${b.credentialId}`;
    expect(await source.loadAssignments(signal)).toEqual([]);
  });
  it("dedicated LOGIN is NOINHERIT, nonprivileged and cannot become collector", async () => {
    const roles = await client`SELECT current_user, rolsuper, rolbypassrls, rolinherit, rolcreaterole
      FROM pg_roles WHERE rolname=current_user`;
    expect(roles[0]).toMatchObject({ current_user: login, rolsuper: false, rolbypassrls: false, rolinherit: false, rolcreaterole: false });
    await expect(client.unsafe("SELECT payload FROM public.trader_account_observations")).rejects.toThrow();
    await expect(client.unsafe("SET ROLE waia_account_observer")).rejects.toThrow();
    expect((await client`SELECT current_user`)[0].current_user).toBe(login);
  });
  it("actual reader role denies secret reads, all writes and row-lock authority", async () => {
    const { b } = await seed();
    for (const sql of ["SELECT encrypted_payload FROM public.exchange_credentials",
      "SELECT permission_metadata FROM public.exchange_credentials",
      "SELECT lease_token FROM public.trader_account_collection_state",
      "UPDATE public.exchange_credentials SET observation_revision=observation_revision",
      "UPDATE public.trader_account_collection_state SET next_due_at=now()",
      "DELETE FROM public.trader_account_observations", "TRUNCATE public.trader_account_observations",
      "INSERT INTO public.trader_account_observations DEFAULT VALUES",
      "SELECT id FROM public.exchange_credentials FOR UPDATE"])
      await expect(restricted(b, sql)).rejects.toThrow();
  });
  it("RLS scopes unfiltered reader queries and resets scope on pooled connection reuse", async () => {
    const { b } = await seed(); await seed();
    expect(await restricted(b, "SELECT observation_id FROM public.trader_account_observations")).toHaveLength(1);
    const rows = await client.begin(async tx => {
      await tx.unsafe("SET LOCAL ROLE waia_account_observation_reader");
      return tx.unsafe("SELECT observation_id FROM public.trader_account_observations");
    });
    expect(rows).toHaveLength(0);
    expect(await reader.resolveActiveBinding({ ...scope(b), organizationId: randomUUID() })).toBeNull();
    expect(await reader.resolveActiveBinding({ ...scope(b), exchangeAccountId: "wrong" })).toBeNull();
  });
  it("revoke between binding resolution and read hides retained evidence", async () => {
    const { b } = await seed(); expect(await reader.resolveActiveBinding(scope(b))).toEqual(b);
    await admin`UPDATE public.exchange_credentials SET status='revoked' WHERE id=${b.credentialId}`;
    expect(await reader.readLatest(b)).toBeNull();
    expect(await reader.resolveActiveBinding(scope(b))).toBeNull();
    expect((await admin`SELECT count(*) FROM public.trader_account_observations WHERE credential_id=${b.credentialId}`)[0].count).toBe("1");
  });
  it("rotation and configuration revisions fence old projections", async () => {
    const { b } = await seed();
    await admin`UPDATE public.exchange_credentials SET permission_metadata='synthetic-change' WHERE id=${b.credentialId}`;
    const current = await reader.resolveActiveBinding(scope(b));
    expect(current?.credentialRevision).toBe("2");
    expect(await reader.readLatest(b)).toBeNull(); expect(await reader.readLatest(current!)).toBeNull();
    const next = await seed();
    await admin`UPDATE public.trader_account_collection_state SET configuration_revision='config-2' WHERE credential_id=${next.b.credentialId}`;
    expect(await reader.readLatest(next.b)).toBeNull();
    expect(await reader.readLatest({ ...next.b, configurationRevision: "config-2" })).toBeNull();
  });
  it("missing projection is not synthetic zero", async () => {
    const { b } = await seed();
    await admin`UPDATE public.trader_account_collection_state SET last_observation_id=NULL WHERE credential_id=${b.credentialId}`;
    expect(await reader.resolveActiveBinding(scope(b))).toEqual(b); expect(await reader.readLatest(b)).toBeNull();
  });
  it("strict parser refuses malformed, cross-bound, wrong-ID and wrong-symbol payloads safely", async () => {
    const mutations = [
      (o: AccountObservation) => ({ ...o, rawVenueObservation: "sensitive-synthetic-marker" }),
      (o: AccountObservation) => ({ ...o, binding: { ...o.binding, organizationId: randomUUID() } }),
      (o: AccountObservation) => ({ ...o, observationId: randomUUID() }),
      (o: AccountObservation) => ({ ...o, trades: [{ ...o.trades[0], symbol: "ETHUSDT" }] }),
      (o: AccountObservation) => ({ ...o, balances: { ...o.balances, sourceAsOfMs: o.collectionCompletedAtMs + 1 } }),
    ];
    for (const mutation of mutations) {
      const { b } = await seed(mutation);
      await expect(reader.readLatest(b)).rejects.toThrow(/^ACCOUNT_OBSERVATION_READ_FAILED$/);
    }
  });
  it("reader does not acquire credential write locks or wait for collector row locks", async () => {
    const { b, observation } = await seed();
    let acquired!: () => void; let release!: () => void;
    const locked = new Promise<void>(r => { acquired = r; }); const finish = new Promise<void>(r => { release = r; });
    const holder = admin.begin(async tx => {
      await tx`SELECT id FROM public.exchange_credentials WHERE id=${b.credentialId} FOR UPDATE`;
      acquired(); await finish;
    });
    await locked;
    try { expect(await reader.readLatest(b)).toEqual(observation); }
    finally { release(); await holder; }
  });
});

// DEE-979: kept in this CI-selected file so case-only changes trigger PostgreSQL checks.
describe.skipIf(!enabled)("DEE-979 actual PostgreSQL 17 host session attestation", () => {
  let root: Sql; let admin: Sql; let db: string;
  const clients: Sql[] = []; let serial = 0;
  beforeAll(async () => {
    root = postgres(url, { max: 1, connect_timeout: 3, prepare: false });
    const version = Number((await root`SHOW server_version_num`)[0].server_version_num);
    expect(version).toBeGreaterThanOrEqual(170000); expect(version).toBeLessThan(180000);
    db = "dee979_host_" + randomUUID().replaceAll("-", "");
    await root.unsafe(`CREATE DATABASE "${db}"`);
    admin = postgres(url.replace("/waia_dee960_local", "/" + db), { max: 1, connect_timeout: 3, prepare: false });
    await admin.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dee960_local_owner') THEN
        CREATE ROLE dee960_local_owner NOLOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    END $$;
    GRANT USAGE, CREATE ON SCHEMA public TO dee960_local_owner WITH GRANT OPTION;`);
    await admin.begin(async tx => {
      await tx.unsafe("SET LOCAL ROLE dee960_local_owner");
      await tx.unsafe("CREATE TABLE public.organizations (id uuid PRIMARY KEY)");
      for (const path of ["db/migrations_postgres/0006_exchange_credentials.sql",
        "db/migrations_postgres/0007_exchange_credentials_rls.sql", "db/migrations_postgres/0205_trader_account_observation_v1.sql"])
        await tx.unsafe(readFileSync(path, "utf8").replaceAll("--> statement-breakpoint", ""));
    });
  }, 30000);
  afterAll(async () => {
    for (const sql of clients) await sql.end({ timeout: 2 });
    await admin?.end({ timeout: 2 }); await root?.end({ timeout: 2 });
    // Unique synthetic DB/LOGINs retained for diagnosis. Never remove user data.
  });
  async function login(purpose: "collector" | "reader", membership = "WITH INHERIT FALSE, SET TRUE") {
    const name = `${db}_${++serial}`;
    const role = purpose === "reader" ? "waia_account_observation_reader" : "waia_account_observer";
    await admin.unsafe(`CREATE ROLE "${name}" LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
      PASSWORD 'synthetic_host_only'; GRANT ${role} TO "${name}" ${membership};`);
    const sql = postgres(`postgres://${name}:synthetic_host_only@127.0.0.1:55460/${db}`, observationPoolLimits);
    clients.push(sql); return { name, sql };
  }
  it("attests two distinct constrained LOGINs and leaves no role or timeout session residue", async () => {
    const collector = await login("collector"); const reader = await login("reader");
    expect(await probeObservationPool(collector.sql, "collector")).toBe(collector.name);
    expect(await probeObservationPool(reader.sql, "reader")).toBe(reader.name);
    expect(collector.name).not.toBe(reader.name);
    for (const { name, sql } of [collector, reader]) {
      expect((await sql`SELECT current_user::text AS role, current_setting('statement_timeout') AS timeout`)[0])
        .toEqual({ role: name, timeout: "0" });
      await expect(sql`SELECT encrypted_payload FROM public.exchange_credentials`).rejects.toThrow();
    }
  });
  it("actual protected host composes and drains fresh attested pools without accessing an account", async () => {
    const collector = await login("collector"); const reader = await login("reader");
    const stop = new AbortController(); const closed: string[] = []; const events: string[] = [];
    const host = createAccountObservationHost({ configured: [], host: "api.huobi.pro", ownerId: "synthetic-host",
      intervalMs: 1000, iterationTimeoutMs: 2000, openTimeoutMs: 5000, shutdownTimeoutMs: 2000,
      openCollector: async () => ({ sql: collector.sql, async dispose() { closed.push("collector"); await collector.sql.end({ timeout: 1 }); } }),
      openReader: async () => ({ sql: reader.sql, async dispose() { closed.push("reader"); await reader.sql.end({ timeout: 1 }); } }),
      openCredentialService: async () => ({ service: { async getDecryptedCredentials() { throw new Error("NO_ACCOUNT_ACCESS_ALLOWED"); } },
        async dispose() { closed.push("credential-provider"); } }),
      async fetchImpl() { throw new Error("NO_NETWORK_ALLOWED"); }, clock: accountObservationClock,
      report(event) { events.push(event); if (event === "HOST_STARTED") stop.abort(); } });
    await host.run(stop.signal); await host.stop();
    expect(events).toEqual(["HOST_STARTED", "HOST_STOPPED"]);
    expect(closed).toEqual(["credential-provider", "reader", "collector"]);
    await expect(host.run(new AbortController().signal)).rejects.toThrow();
  });
  it("membership without SET cannot pass and collector cannot masquerade as reader", async () => {
    const member = await login("reader", "WITH INHERIT FALSE, SET FALSE");
    expect((await member.sql`SELECT pg_has_role(session_user, 'waia_account_observation_reader', 'MEMBER') AS member,
      pg_has_role(session_user, 'waia_account_observation_reader', 'SET') AS can_set`)[0]).toEqual({ member: true, can_set: false });
    await expect(probeObservationPool(member.sql, "reader")).rejects.toThrow("OBSERVATION_HOST_ROLE_REFUSED");
    await expect(probeObservationPool((await login("collector")).sql, "reader")).rejects.toThrow();
  });
  it("refuses direct or inherited extra role authority and INHERIT sessions", async () => {
    const direct = await login("reader");
    await admin.unsafe(`GRANT waia_account_observer TO "${direct.name}" WITH INHERIT FALSE, SET TRUE`);
    await expect(probeObservationPool(direct.sql, "reader")).rejects.toThrow();
    const indirect = await login("reader"); const extra = `${db}_extra`;
    await admin.unsafe(`CREATE ROLE "${extra}" NOLOGIN; GRANT pg_read_all_data TO "${extra}";
      GRANT "${extra}" TO "${indirect.name}" WITH INHERIT TRUE, SET TRUE`);
    await expect(probeObservationPool(indirect.sql, "reader")).rejects.toThrow();
    const inherited = await login("reader"); await admin.unsafe(`ALTER ROLE "${inherited.name}" INHERIT`);
    await expect(probeObservationPool(inherited.sql, "reader")).rejects.toThrow();
  });
  it("refuses PUBLIC secret or write grants and retains a passing baseline after revocation", async () => {
    const reader = await login("reader");
    await admin`GRANT SELECT (encrypted_payload) ON public.exchange_credentials TO PUBLIC`;
    try { await expect(probeObservationPool(reader.sql, "reader")).rejects.toThrow(); }
    finally { await admin`REVOKE SELECT (encrypted_payload) ON public.exchange_credentials FROM PUBLIC`; }
    await admin`GRANT UPDATE (symbols) ON public.trader_account_collection_state TO PUBLIC`;
    try { await expect(probeObservationPool(reader.sql, "reader")).rejects.toThrow(); }
    finally { await admin`REVOKE UPDATE (symbols) ON public.trader_account_collection_state FROM PUBLIC`; }
    expect(await probeObservationPool(reader.sql, "reader")).toBe(reader.name);
  });
  it("refuses role-local forbidden writes and disabled forced RLS", async () => {
    const reader = await login("reader");
    await admin`GRANT DELETE ON public.trader_account_observations TO waia_account_observation_reader`;
    try { await expect(probeObservationPool(reader.sql, "reader")).rejects.toThrow(); }
    finally { await admin`REVOKE DELETE ON public.trader_account_observations FROM waia_account_observation_reader`; }
    await admin`ALTER TABLE public.trader_account_observations NO FORCE ROW LEVEL SECURITY`;
    try { await expect(probeObservationPool(reader.sql, "reader")).rejects.toThrow(); }
    finally { await admin`ALTER TABLE public.trader_account_observations FORCE ROW LEVEL SECURITY`; }
    expect(await probeObservationPool(reader.sql, "reader")).toBe(reader.name);
  });
});
