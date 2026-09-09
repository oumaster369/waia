import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres, { type Sql } from "postgres";
import { createPostgresObservationReader } from "@/lib/trader/account-observation/postgres-reader";
import { createPostgresObservationAssignmentSource } from "@/lib/trader/account-observation/postgres-assignments";
import { createObservationConfiguration } from "@/lib/trader/account-observation/runtime";
import type { AccountObservation, ObservationBinding } from "@/lib/trader/account-observation/types";

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
