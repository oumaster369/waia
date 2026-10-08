// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres, { type Sql } from "postgres";
import { createPostgresObservationRepository } from "@/lib/trader/account-observation/postgres-repository";
import { createPostgresObservationReader } from "@/lib/trader/account-observation/postgres-reader";
import { unavailableHtxV5Bills } from "@/lib/trader/account-observation/derivatives/htx-v5-bill-groups";
import { parseAccountObservation } from "@/lib/trader/account-observation/validation";
import type { AccountObservation, HtxV5AccountObservation, ObservationBinding, ObservationLease } from "@/lib/trader/account-observation/types";

// Authoring does not execute this fixture. Root provisions this one synthetic TLS target.
// No environment URL fallback, remote target, foreign 55460 fixture, or general migrator.
const enabled = process.env.DEE1233_FINANCIAL_PG17 === "1";
const database = "waia_financial_fixture";
const target = "127.0.0.1:55841/waia_financial_fixture";
const password = "local_journal_fixture_only";
describe.skipIf(!enabled)("DEE-1233 financial JSON publication on isolated TLS PostgreSQL 17", () => {
  let admin: Sql; let collector: Sql; let projection: Sql;
  let repo: ReturnType<typeof createPostgresObservationRepository>;
  let reader: ReturnType<typeof createPostgresObservationReader>;
  beforeAll(async () => {
    const caPath = process.env.DEE1233_FINANCIAL_CA;
    if (!caPath) throw new Error("DEE1233_FINANCIAL_CA_REQUIRED");
    const ssl = { rejectUnauthorized: true, ca: readFileSync(caPath, "utf8") };
    const options = { ssl, max: 1, prepare: false, connect_timeout: 3, max_lifetime: 60 } as const;
    admin = postgres(`postgres://postgres:${password}@${target}`, options);
    const info = (await admin`SELECT current_database() AS db, current_setting('server_version_num')::int AS version,
      (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls`)[0];
    expect(info.db).toBe(database); expect(info.version).toBeGreaterThanOrEqual(170000);
    expect(info.version).toBeLessThan(180000); expect(info.tls).toBe(true);
    // A root-created empty fixture is required. Never replace an existing dataset.
    expect(Number((await admin`SELECT count(*) AS n FROM information_schema.tables WHERE table_schema='public'`)[0].n)).toBe(0);
    await admin.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    END $$; CREATE TABLE public.organizations(id uuid PRIMARY KEY);`);
    // Exact minimal existing migrations, including 0205's reader-role policy blocks.
    // No production journal or 0229/0230/0231 replay is involved.
    for (const path of ["db/migrations_postgres/0006_exchange_credentials.sql", "db/migrations_postgres/0007_exchange_credentials_rls.sql",
      "db/migrations_postgres/0205_trader_account_observation_v1.sql"])
      await admin.unsafe(readFileSync(path, "utf8").replaceAll("--> statement-breakpoint", ""));
    const suffix = randomUUID().replaceAll("-", "");
    const collectorLogin = `fin_collect_${suffix}`, readerLogin = `fin_read_${suffix}`;
    for (const [login, role] of [[collectorLogin, "waia_account_observer"], [readerLogin, "waia_account_observation_reader"]]) {
      await admin.unsafe(`CREATE ROLE "${login}" LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
        PASSWORD '${password}'; GRANT ${role} TO "${login}" WITH INHERIT FALSE, SET TRUE;
        GRANT CONNECT ON DATABASE ${database} TO "${login}";`);
    }
    collector = postgres(`postgres://${collectorLogin}:${password}@${target}`, options);
    projection = postgres(`postgres://${readerLogin}:${password}@${target}`, options);
    for (const [client, login] of [[collector, collectorLogin], [projection, readerLogin]] as const) {
      expect((await client`SELECT session_user AS name, (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls`)[0])
        .toMatchObject({ name: login, tls: true });
      expect((await client`SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolinherit FROM pg_roles WHERE rolname=session_user`)[0])
        .toMatchObject({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolinherit: false });
    }
    repo = createPostgresObservationRepository(collector); reader = createPostgresObservationReader(projection);
    // Delay only amount-bearing synthetic INSERTs when explicitly requested by test config.
    // The second, sanitized transaction is not delayed and cannot reuse the amount payload.
    await admin.unsafe(`CREATE SEQUENCE public.financial_fixture_insert_attempt_seq;
      GRANT USAGE ON SEQUENCE public.financial_fixture_insert_attempt_seq TO waia_account_observer;
      CREATE TABLE public.financial_fixture_delay (id boolean PRIMARY KEY, delay_ms integer NOT NULL);
      INSERT INTO public.financial_fixture_delay VALUES (true, 0);
      GRANT SELECT ON public.financial_fixture_delay TO waia_account_observer;
      CREATE FUNCTION public.financial_fixture_delay_insert() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
      DECLARE duration integer; BEGIN
        PERFORM nextval('public.financial_fixture_insert_attempt_seq');
        SELECT delay_ms INTO duration FROM public.financial_fixture_delay WHERE id;
        IF duration > 0 AND NEW.payload#>>'{htxV5,bills,status}'='PARTIAL' THEN PERFORM pg_sleep(duration::numeric/1000); END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER financial_fixture_delay BEFORE INSERT ON public.trader_account_observations
        FOR EACH ROW EXECUTE FUNCTION public.financial_fixture_delay_insert();`);
  }, 30000);
  afterAll(async () => {
    await projection?.end({ timeout: 2 }); await collector?.end({ timeout: 2 }); await admin?.end({ timeout: 2 });
    // Retain only this synthetic database and its roles for root diagnosis/owned cleanup.
  });
  async function seed(): Promise<ObservationBinding> {
    const binding = { organizationId: randomUUID(), credentialId: randomUUID(), exchangeAccountId: "12345678",
      credentialRevision: "1", configurationRevision: `scope-${randomUUID()}` };
    await admin`INSERT INTO public.organizations VALUES (${binding.organizationId})`;
    await admin`INSERT INTO public.exchange_credentials (id,organization_id,venue,exchange_account_id,encrypted_payload)
      VALUES (${binding.credentialId},${binding.organizationId},'htx',${binding.exchangeAccountId},'synthetic-no-key')`;
    await admin`INSERT INTO public.trader_account_collection_state (organization_id,credential_id,exchange_account_id,configuration_revision,symbols)
      VALUES (${binding.organizationId},${binding.credentialId},${binding.exchangeAccountId},${binding.configurationRevision},'["BTCUSDT"]')`;
    return binding;
  }
  async function lease(binding: ObservationBinding): Promise<ObservationLease> {
    const result = await repo.claimDue(binding, "financial-fixture", Date.now(), 60000);
    expect(result).not.toBeNull(); return result!;
  }
  function observation(binding: ObservationBinding, t = Date.now(), validUntilMs = t + 10000): AccountObservation {
    const scope = { enabled: true as const, scopeId: randomUUID(), windowStartMs: t - 2000, windowEndMs: t - 1000,
      validFromMs: t - 1000, validUntilMs };
    const base = { status: "COMPLETE" as const, values: [], sourceAsOfMs: null, readStartedAtMs: t, readCompletedAtMs: t, error: null };
    const balances = { ...base, values: [{ asset: "USDT", free: "42", locked: "0", total: "42" }] };
    const v5time = { readStartedAtMs: t, readCompletedAtMs: t, responseGeneratedAtMs: null, error: null };
    const v5: HtxV5AccountObservation = { schemaVersion: "htx-v5-observation/v2", htxUid: "456",
      assetMode: { status: "COMPLETE", value: "1", ...v5time },
      balance: { status: "COMPLETE", value: { state: "normal", account: { equityUsd: "42", initialMarginUsd: "0", maintenanceMarginUsd: "0",
        maintenanceMarginRate: "0", profitUnrealUsd: "0", availableMarginUsd: "42", voucherValue: "0", createdTimeMs: null, updatedTimeMs: null }, details: [] }, ...v5time },
      positions: { status: "COMPLETE", values: [], ...v5time, pageScope: null },
      openOrders: { status: "PARTIAL", values: [], ...v5time, pageScope: { pageSize: 100, maxPages: 2, pagesRead: 1, nextFrom: null, completeness: "UNKNOWN" } },
      algoOrders: { status: "PARTIAL", values: [], ...v5time, pageScope: { pageSize: 20, maxPagesPerType: 2,
        queries: ["tp","sl","tpsl","trigger","trailing_stop"].map(type => ({ type, pagesRead: 1, nextFrom: null })), completeness: "UNKNOWN" } },
      fills: { status: "NOT_CONFIGURED", values: null, readStartedAtMs: null, readCompletedAtMs: null, responseGeneratedAtMs: null,
        error: null, coverage: "NOT_CONFIGURED", contracts: [], windowStartMs: null, windowEndMs: null, pageScope: null },
      bills: { ...unavailableHtxV5Bills(scope, "SCOPE_EXPIRED"), status: "PARTIAL", unavailableReason: null,
        values: [{ id: "1", contractCode: "", marginMode: "cross", currency: "USDT", type: "30", category: "FUNDING_INCOME", amount: "0.25", createdTimeMs: t - 1500 }],
        groups: [{ currency: "USDT", type: "30", category: "FUNDING_INCOME", observedAmountSum: "0.25", recordCount: 1 }],
        ...v5time, responseReceivedAtMs: t, pageScope: { pageSize: 100, maxPages: 1, pagesRead: 1, nextFrom: "1", completeness: "UNKNOWN" } } };
    return parseAccountObservation({ schemaVersion: "account-observation/v4", observationId: randomUUID(), binding,
      collectionStartedAtMs: t, collectionCompletedAtMs: t, status: "PARTIAL", balances, openOrders: base,
      trades: [{ symbol: "BTCUSDT", component: base }], holdings: balances.values, htxV5: v5 });
  }
  function commit(l: ObservationLease, o: AccountObservation) {
    const now = Date.now(); return repo.commitIfCurrent({ lease: l, observation: o, nowMs: now, nextDueAtMs: now + 10000, consecutiveFailures: 0 });
  }
  async function assertSingle(o: AccountObservation) {
    const rows = await admin`SELECT o.payload, s.last_observation_id FROM trader_account_observations o
      JOIN trader_account_collection_state s USING(organization_id,credential_id,exchange_account_id)
      WHERE o.credential_id=${o.binding.credentialId}`;
    expect(rows).toHaveLength(1); expect(rows[0].last_observation_id).toBe(o.observationId);
    expect(parseAccountObservation(rows[0].payload)).toEqual(o);
    expect((await reader.readLatest(o.binding))?.balances).toEqual(o.balances);
  }
  it("appends exact active v4 and reads it through a separate restricted LOGIN", async () => {
    const b = await seed(), l = await lease(b), o = observation(b);
    expect(await commit(l,o)).toEqual({ observation: o }); expect(await reader.readLatest(b)).toEqual(o); await assertSingle(o);
  });
  it("sanitizes scope expired before append, keeps balances, and accepts only exact sanitized acknowledgement", async () => {
    const b = await seed(), l = await lease(b), now = Date.now(); const o = observation(b, now - 2000, now - 1000);
    const result = await commit(l,o); expect(result).toMatchObject({ observation: { balances: o.balances,
      htxV5: { bills: { status: "UNAVAILABLE", unavailableReason: "SCOPE_EXPIRED", values: null, groups: null } } } });
    if (!result || typeof result !== "object") throw new Error("EXPECTED_STORED_FINANCIAL_ACK");
    await assertSingle(result.observation); expect(await commit(l,o)).toEqual(result);
    expect(await commit(l, { ...o, balances: { ...o.balances, values: [] }, holdings: [] })).toBe(false);
  });
  it("refuses replay of an earlier amount-bearing row once its exact scope expires", async () => {
    const b = await seed(), l = await lease(b), o = observation(b, Date.now(), Date.now() + 500);
    expect(await commit(l,o)).toEqual({ observation: o });
    await admin`SELECT pg_sleep(0.55)`;
    expect(await commit(l,o)).toBe(false); await assertSingle(o);
  });
  it("rolls back an INSERT crossing expiry and retries exactly one amount-free base publication", async () => {
    const b = await seed(), l = await lease(b);
    const before = Number((await admin`SELECT nextval('public.financial_fixture_insert_attempt_seq') AS n`)[0].n);
    await admin`UPDATE financial_fixture_delay SET delay_ms=750 WHERE id`;
    const o = observation(b, Date.now(), Date.now() + 500);
    try {
      const result = await commit(l,o); expect(result).toMatchObject({ observation: { balances: o.balances,
        htxV5: { balance: o.htxV5!.balance, bills: { status: "UNAVAILABLE", unavailableReason: "SCOPE_EXPIRED", values: null, groups: null } } } });
      if (!result || typeof result !== "object") throw new Error("EXPECTED_STORED_FINANCIAL_ACK");
      await assertSingle(result.observation);
      expect(Number((await admin`SELECT last_value AS n FROM public.financial_fixture_insert_attempt_seq`)[0].n) - before).toBe(2);
      expect((await admin`SELECT consecutive_failures,lease_token FROM trader_account_collection_state WHERE credential_id=${b.credentialId}`)[0])
        .toMatchObject({ consecutive_failures: 0, lease_token: null });
    } finally { await admin`UPDATE financial_fixture_delay SET delay_ms=0 WHERE id`; }
  });
  it("owns the original observation, lease and cadence across caller mutation during the expiry retry", async () => {
    const b = await seed(), l = await lease(b);
    const pid = Number((await collector`SELECT pg_backend_pid() AS pid`)[0].pid);
    const before = Number((await admin`SELECT nextval('public.financial_fixture_insert_attempt_seq') AS n`)[0].n);
    await admin`UPDATE financial_fixture_delay SET delay_ms=1500 WHERE id`;
    const now = Date.now(), o = observation(b, now, now + 1000);
    const expected = parseAccountObservation(o);
    const input = { lease: { ...l, binding: { ...l.binding } }, observation: o,
      nowMs: now, nextDueAtMs: now + 10000, consecutiveFailures: 0 };
    const pending = repo.commitIfCurrent(input);
    try {
      // Observe the real amount-bearing INSERT inside its trigger, before replacing inputs.
      // The nontransactional counter also proves rollback plus exactly one sanitized retry.
      let waiting = false;
      for (const deadline = Date.now() + 1200; Date.now() < deadline;) {
        const activity = await admin`SELECT wait_event, query FROM pg_stat_activity WHERE pid=${pid}`;
        if (activity[0]?.wait_event === "PgSleep" &&
          String(activity[0]?.query).includes("INSERT INTO public.trader_account_observations")) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      // Exercise both nested aliases and replacement of the top-level caller properties.
      Object.assign(input.observation.balances.values![0], { free: "777", total: "777" });
      Object.assign(input.lease.binding, { configurationRevision: "caller-mutated" });
      Object.assign(input.lease, { token: randomUUID(), ownerId: "caller-mutated" });
      const replacementBinding = { ...b, configurationRevision: "caller-replaced" };
      input.observation = observation(replacementBinding);
      input.lease = { ...l, binding: replacementBinding, token: randomUUID(), ownerId: "caller-replaced" };
      input.nowMs = now + 5000; input.nextDueAtMs = now + 65000; input.consecutiveFailures = 30;
      const result = await pending;
      expect(result).toMatchObject({ observation: { observationId: expected.observationId,
        binding: expected.binding, balances: expected.balances, holdings: expected.holdings,
        htxV5: { bills: { status: "UNAVAILABLE", unavailableReason: "SCOPE_EXPIRED", values: null, groups: null } } } });
      if (!result || typeof result !== "object") throw new Error("EXPECTED_STORED_FINANCIAL_ACK");
      await assertSingle(result.observation);
      const state = (await admin`SELECT o.lease_token, s.consecutive_failures,
        extract(epoch from (s.next_due_at-o.recorded_at))*1000 AS delay_ms
        FROM trader_account_observations o JOIN trader_account_collection_state s
          USING(organization_id,credential_id,exchange_account_id) WHERE o.credential_id=${b.credentialId}`)[0];
      expect(state).toMatchObject({ lease_token: l.token, consecutive_failures: 0 });
      expect(Number(state.delay_ms)).toBeGreaterThanOrEqual(10000);
      expect(Number(state.delay_ms)).toBeLessThan(12000);
      expect(Number((await admin`SELECT last_value AS n FROM public.financial_fixture_insert_attempt_seq`)[0].n) - before).toBe(2);
    } finally {
      await pending.catch(() => undefined);
      await admin`UPDATE financial_fixture_delay SET delay_ms=0 WHERE id`;
    }
  });
  it("fences stale configuration, rotation and cross-tenant reads without granting new scope", async () => {
    const b = await seed(), l = await lease(b), o = observation(b);
    expect(await commit({ ...l, binding: { ...b, configurationRevision: "stale" } }, { ...o, binding: { ...b, configurationRevision: "stale" } })).toBe(false);
    expect(await reader.readLatest({ ...b, organizationId: randomUUID() })).toBeNull();
    await admin`UPDATE exchange_credentials SET encrypted_payload='synthetic-rotated' WHERE id=${b.credentialId}`;
    expect(await commit(l,o)).toBe(false); expect(await reader.readLatest(b)).toBeNull();
    expect(Number((await admin`SELECT count(*) AS n FROM trader_account_observations WHERE credential_id=${b.credentialId}`)[0].n)).toBe(0);
  });
});
