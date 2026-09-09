import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres, { type Sql } from "postgres";
import { createPostgresObservationRepository } from "@/lib/trader/account-observation/postgres-repository";
import { createAccountObservationService } from "@/lib/trader/account-observation/service";
import { accountObservationClock } from "@/lib/trader/account-observation/clock";
import { createObservationConfiguration, createPostgresAccountObservationRuntime } from "@/lib/trader/account-observation/runtime";
import { openHtxObservationReader } from "@/lib/trader/account-observation/htx-reader-opener";
import { handleAccountObservationGet, type ObservationReadDependencies } from "@/lib/trader/account-observation/read-handler";
import type { AccountObservation, ObservationBinding, ObservationLease } from "@/lib/trader/account-observation/types";

// Deliberately isolated: never fall back to DATABASE_URL_POSTGRES / production env.
const enabled = process.env.DEE960_LOCAL_PG17 === "1";
const url = "postgres://waia_local_admin:local_validation_only@127.0.0.1:55460/waia_dee960_local";
describe.skipIf(!enabled)("DEE-960 actual PostgreSQL 17 fenced observation storage", () => {
  let root: Sql;
  let admin: Sql;
  let client: Sql;
  let repo: ReturnType<typeof createPostgresObservationRepository>;
  beforeAll(async () => {
    root = postgres(url, { max: 1, connect_timeout: 3, prepare: false });
    const version = await root`SHOW server_version_num`;
    expect(Number(version[0].server_version_num)).toBeGreaterThanOrEqual(170000);
    expect(Number(version[0].server_version_num)).toBeLessThan(180000);
    const name = "dee960_" + randomUUID().replaceAll("-", "");
    await root.unsafe('CREATE DATABASE "' + name + '"');
    admin = postgres(url.replace("/waia_dee960_local", "/" + name), { max: 5, connect_timeout: 3, prepare: false });
    await admin.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dee960_local_owner') THEN
        CREATE ROLE dee960_local_owner NOLOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    END $$;
    GRANT USAGE, CREATE ON SCHEMA public TO dee960_local_owner WITH GRANT OPTION;`);
    // Schema DDL runs under a limited administrator, not postgres superuser.
    await admin.begin(async tx => {
      await tx.unsafe("SET LOCAL ROLE dee960_local_owner");
      await tx.unsafe("CREATE TABLE public.organizations (id uuid PRIMARY KEY)");
      await tx.unsafe(readFileSync("db/migrations_postgres/0006_exchange_credentials.sql", "utf8").replaceAll("--> statement-breakpoint", ""));
      await tx.unsafe(readFileSync("db/migrations_postgres/0007_exchange_credentials_rls.sql", "utf8"));
      await tx.unsafe(readFileSync("db/local-validation/dee960-account-observation.sql", "utf8"));
    });
    await admin.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dee960_local_collector') THEN
        CREATE ROLE dee960_local_collector LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
          NOCREATEDB NOCREATEROLE PASSWORD 'local_validation_only';
      END IF;
    END $$;
    GRANT waia_account_observer TO dee960_local_collector;`);
    client = postgres(url.replace("waia_local_admin:", "dee960_local_collector:").replace("/waia_dee960_local", "/" + name),
      { max: 4, connect_timeout: 3, prepare: false, connection: { statement_timeout: 3000 } });
    repo = createPostgresObservationRepository(client);
    expect((await client`SELECT session_user`)[0].session_user).toBe("dee960_local_collector");
  }, 30000);
  afterAll(async () => {
    await client?.end({ timeout: 2 }); await admin?.end({ timeout: 2 }); await root?.end({ timeout: 2 });
    // Retain isolated synthetic DB for diagnosis. Never drop any user database.
  });
  async function seed(exchangeAccountId: string = randomUUID()): Promise<ObservationBinding> {
    const b = { organizationId: randomUUID(), credentialId: randomUUID(), exchangeAccountId,
      credentialRevision: "1", configurationRevision: "config-1" };
    await admin`INSERT INTO public.organizations VALUES (${b.organizationId})`;
    await admin`INSERT INTO public.exchange_credentials
      (id, organization_id, venue, exchange_account_id, encrypted_payload)
      VALUES (${b.credentialId}, ${b.organizationId}, 'htx', ${b.exchangeAccountId}, 'synthetic-not-a-key')`;
    await admin`INSERT INTO public.trader_account_collection_state
      (organization_id, credential_id, exchange_account_id, configuration_revision, symbols)
      VALUES (${b.organizationId}, ${b.credentialId}, ${b.exchangeAccountId}, ${b.configurationRevision}, '["BTCUSDT"]')`;
    return b;
  }
  it("runs recurring PostgreSQL collection without a browser and persists cadence across restart", async () => {
    const config = createObservationConfiguration({ symbols: ["BTCUSDT"], pollIntervalMs: 1000,
      maxBackoffMs: 8000, readTimeoutMs: 100, leaseTtlMs: 3000 });
    const b = { ...await seed("123456"), configurationRevision: config.revision };
    await admin`UPDATE trader_account_collection_state SET configuration_revision=${config.revision}
      WHERE credential_id=${b.credentialId}`;
    let reads = 0; let commits = 0; let releasedHandles = 0;
    const stop = new AbortController();
    // Real opener/signing/reader/service/repository composition. Only synthetic
    // keys and in-memory HTTP responses; admission is a fixture, not production proof.
    const openReader = (scope: ObservationBinding, signal: AbortSignal) => openHtxObservationReader({
      clock: accountObservationClock, host: "api.huobi.pro", authorizeOpen: async () => true,
      verifyReadAdmission: async () => true,
      openCredential: async () => ({ binding: scope, apiKey: "synthetic-key", apiSecret: "synthetic-secret",
        dispose() { releasedHandles++; } }),
      async fetchImpl(url, init) {
        expect(init?.method).toBe("GET"); expect(init?.redirect).toBe("error");
        const request = new URL(String(url));
        expect(request.origin).toBe("https://api.huobi.pro");
        expect(request.searchParams.get("Signature")).toBeTruthy();
        let data: unknown = [];
        if (request.pathname.endsWith("/balance")) {
          reads++; data = { id: 123456, type: "spot", state: "working",
            list: [{ currency: "usdt", type: "trade", balance: "42" }, { currency: "usdt", type: "frozen", balance: "0" }] };
        }
        return new Response(JSON.stringify({ status: "ok", data }));
      } }, { binding: scope, symbols: config.symbols, readTimeoutMs: config.readTimeoutMs,
      pageSize: 10, maxPages: 1, maxRecords: 20, maxResponseBytes: 4096, tradeWindowMs: 3600000 }, signal);
    const safety = setTimeout(() => stop.abort(), 10000);
    try {
      await createPostgresAccountObservationRuntime({ sql: client, loadAssignments: async () => [{ binding: b, config }],
        openReader, report(event) { if (event === "COLLECTION_COMMITTED" && ++commits === 2) stop.abort(); },
        ownerId: "local-recurring-proof", iterationTimeoutMs: 5000 }).run(stop.signal);
    } finally { clearTimeout(safety); }
    expect(commits).toBe(2); expect(reads).toBe(2); expect(releasedHandles).toBe(2);
    const latest = await repo.readLatest(b);
    expect(latest).toMatchObject({ status: "PARTIAL", holdings: [{ asset: "USDT", total: "42" }] });
    expect((await admin`SELECT count(*)::int AS n FROM trader_account_observations WHERE credential_id=${b.credentialId}`)[0].n).toBe(2);
    // A fresh runtime must honor the stored cadence rather than collecting on every process start.
    await admin`UPDATE trader_account_collection_state SET next_due_at=clock_timestamp()+interval '1 hour'
      WHERE credential_id=${b.credentialId}`;
    const again = new AbortController();
    const finished = setTimeout(() => again.abort(), 150);
    try {
      await createPostgresAccountObservationRuntime({ sql: client, loadAssignments: async () => [{ binding: b, config }],
        openReader, report() {}, ownerId: "local-restarted-proof" }).run(again.signal);
    } finally { clearTimeout(finished); }
    expect(reads).toBe(2);
    await admin`UPDATE exchange_credentials SET status='revoked' WHERE id=${b.credentialId}`;
    expect(await repo.readLatest(b)).toBeNull();
  }, 15000);
  function observation(b: ObservationBinding): AccountObservation {
    const t = Date.now();
    const component = { status: "COMPLETE" as const, values: [], sourceAsOfMs: null,
      readStartedAtMs: t, readCompletedAtMs: t, error: null };
    return { schemaVersion: "account-observation/v1", observationId: randomUUID(), binding: b,
      collectionStartedAtMs: t, collectionCompletedAtMs: t, status: "COMPLETE",
      balances: component, openOrders: component, trades: [{ symbol: "BTCUSDT", component }], holdings: [] };
  }
  async function lease(b: ObservationBinding) {
    const l = await repo.claimDue(b, "worker-1", Date.now(), 60000);
    expect(l).not.toBeNull(); return l!;
  }
  function commit(l: ObservationLease, o = observation(l.binding)) {
    const nowMs = Date.now();
    return repo.commitIfCurrent({ lease: l, observation: o, nowMs, nextDueAtMs: nowMs + 10000, consecutiveFailures: 0 });
  }
  async function restricted(b: ObservationBinding, statement: string) {
    return admin.begin(async tx => {
      await tx.unsafe("SET LOCAL ROLE waia_account_observer");
      await tx`SELECT set_config('waia.observation_org', ${b.organizationId}, true),
        set_config('waia.observation_credential', ${b.credentialId}, true),
        set_config('waia.observation_account', ${b.exchangeAccountId}, true)`;
      return tx.unsafe(statement);
    });
  }
  it("commits once, preserves cadence across a new repository and resolves exact retry", async () => {
    const b = await seed(); const l = await lease(b); const o = observation(b);
    expect(await commit(l, o)).toBe(true);
    expect(await commit(l, o)).toBe(true);
    expect(await repo.readLatest(b)).toEqual(o);
    const restarted = createPostgresObservationRepository(client);
    expect(await restarted.claimDue(b, "after-restart", 0, 60000)).toBeNull();
    expect((await admin`SELECT count(*) FROM public.trader_account_observations WHERE credential_id=${b.credentialId}`)[0].count).toBe("1");
    expect(await commit(l, { ...o, collectionCompletedAtMs: o.collectionCompletedAtMs + 1 })).toBe(false);
  });
  it("admits one of two simultaneous collectors", async () => {
    const b = await seed();
    const result = await Promise.all([repo.claimDue(b, "a", 0, 60000), repo.claimDue(b, "b", 0, 60000)]);
    expect(result.filter(Boolean)).toHaveLength(1);
  });
  it("refuses org/account/credential/config/revision mismatches", async () => {
    const b = await seed();
    for (const bad of [{ ...b, organizationId: randomUUID() }, { ...b, exchangeAccountId: "wrong" },
      { ...b, credentialId: randomUUID() }, { ...b, configurationRevision: "wrong" },
      { ...b, credentialRevision: "2" }]) expect(await repo.claimDue(bad, "a", 0, 60000)).toBeNull();
  });
  it("fences a revoked credential and preserves previous evidence without presenting it fresh", async () => {
    const b = await seed(); const l = await lease(b);
    await admin`UPDATE public.exchange_credentials SET status='revoked' WHERE id=${b.credentialId}`;
    expect(await repo.isCurrent(l, 0)).toBe(false);
    expect(await commit(l)).toBe(false);
    expect(await repo.readLatest(b)).toBeNull();
    await repo.release(l);
    expect((await admin`SELECT observation_revision FROM public.exchange_credentials WHERE id=${b.credentialId}`)[0].observation_revision).toBe("2");
  });
  it("same-timestamp changes and ABA cannot revive old authority", async () => {
    const b = await seed(); const l = await lease(b);
    await admin`UPDATE public.exchange_credentials SET permission_metadata='changed' WHERE id=${b.credentialId}`;
    await admin`UPDATE public.exchange_credentials SET permission_metadata=NULL WHERE id=${b.credentialId}`;
    expect(await commit(l)).toBe(false);
    expect((await admin`SELECT observation_revision FROM public.exchange_credentials WHERE id=${b.credentialId}`)[0].observation_revision).toBe("3");
  });
  it("old release cannot release successor; wall-clock supplied by caller cannot revive expiry", async () => {
    const b = await seed(); const old = await lease(b);
    await admin`UPDATE public.trader_account_collection_state SET lease_expires_at=now()-interval '1 second'
      WHERE credential_id=${b.credentialId}`;
    expect(await repo.isCurrent(old, 0)).toBe(false);
    const next = await repo.claimDue(b, "successor", 0, 60000);
    await repo.release(old);
    expect(await repo.isCurrent(next!, 0)).toBe(true);
    expect(await commit(old)).toBe(false);
  });
  it("RLS filters unscoped SELECT, hides other accounts, and denies raw credential reads", async () => {
    const b = await seed(); const other = await seed();
    await commit(await lease(b)); await commit(await lease(other));
    expect(await restricted(b, "SELECT credential_id FROM public.trader_account_observations")).toHaveLength(1);
    await expect(restricted(b, "SELECT encrypted_payload FROM public.exchange_credentials")).rejects.toThrow();
    await expect(restricted(b, "UPDATE public.exchange_credentials SET observation_revision=123")).rejects.toThrow("DATABASE_OWNED");
    await expect(restricted(b, "UPDATE public.exchange_credentials SET status='revoked'")).rejects.toThrow();
    await expect(restricted(b, "DELETE FROM public.trader_account_observations")).rejects.toThrow();
    await expect(restricted(b, "TRUNCATE public.trader_account_observations")).rejects.toThrow();
    const roles = await restricted(b, "SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user");
    expect(roles[0]).toMatchObject({ current_user: "waia_account_observer", rolsuper: false, rolbypassrls: false });
    const empty = await admin.begin(async tx => {
      await tx.unsafe("SET LOCAL ROLE waia_account_observer");
      return tx.unsafe("SELECT * FROM public.trader_account_observations");
    });
    expect(empty).toHaveLength(0);
  });
  it("anonymous and authenticated roles cannot read observations", async () => {
    for (const role of ["anon", "authenticated"]) await expect(admin.begin(async tx => {
      await tx.unsafe("SET LOCAL ROLE " + role);
      await tx.unsafe("SELECT * FROM public.trader_account_observations");
    })).rejects.toThrow();
  });
  it("rollback on commit failure leaves no partial record or cadence change", async () => {
    const b = await seed(); const l = await lease(b);
    // Constraint failure in the SECOND write must roll back the first INSERT.
    await admin.unsafe(`ALTER TABLE public.trader_account_collection_state ADD CONSTRAINT test_commit_rollback
      CHECK (credential_id <> '${b.credentialId}'::uuid OR last_observation_id IS NULL)`);
    await expect(commit(l)).rejects.toThrow("ACCOUNT_OBSERVATION_STORAGE_FAILED");
    expect((await admin`SELECT count(*) FROM public.trader_account_observations WHERE credential_id=${b.credentialId}`)[0].count).toBe("0");
    expect(await repo.isCurrent(l, Date.now())).toBe(true);
  });
  it("revoke holding credential lock wins before subsequent publication", async () => {
    const b = await seed(); const l = await lease(b);
    let locked!: () => void; let finish!: () => void;
    const acquired = new Promise<void>(r => { locked = r; });
    const allowCommit = new Promise<void>(r => { finish = r; });
    const revoke = admin.begin(async tx => {
      await tx`UPDATE public.exchange_credentials SET status='revoked' WHERE id=${b.credentialId}`;
      locked(); await allowCommit;
    });
    await acquired;
    const pending = commit(l);
    finish(); await revoke;
    expect(await pending).toBe(false);
  });
  it("bounded lock timeout is classified, no secret driver payload escapes", async () => {
    const b = await seed(); const l = await lease(b);
    let locked!: () => void; let finish!: () => void;
    const acquired = new Promise<void>(r => { locked = r; });
    const allowCommit = new Promise<void>(r => { finish = r; });
    const holder = admin.begin(async tx => {
      await tx`SELECT id FROM public.exchange_credentials WHERE id=${b.credentialId} FOR UPDATE`;
      locked(); await allowCommit;
    });
    await acquired;
    try { await expect(commit(l)).rejects.toThrow("ACCOUNT_OBSERVATION_STORAGE_FAILED"); }
    finally { finish(); await holder; }
    expect(await repo.isCurrent(l, 0)).toBe(true);
  });
  it("rejects raw fields and wrong symbol sets before storage", async () => {
    const b = await seed(); const l = await lease(b); const o = observation(b);
    await expect(commit(l, { ...o, rawVenueObservation: "not-allowed" } as AccountObservation)).rejects.toThrow();
    expect(await commit(l, { ...o, trades: [{ ...o.trades[0], symbol: "ETHUSDT" }] })).toBe(false);
  });
  it("release persists failed-open backoff across service reconstruction", async () => {
    const b = await seed(); const l = await lease(b);
    await repo.release(l);
    const restarted = createPostgresObservationRepository(client);
    expect(await restarted.claimDue(b, "retry", Date.now(), 60000)).toBeNull();
    const rows = await admin`SELECT consecutive_failures, lease_token FROM public.trader_account_collection_state
      WHERE credential_id=${b.credentialId}`;
    expect(rows[0]).toMatchObject({ consecutive_failures: 1, lease_token: null });
  });
  it("expires during INSERT: second-write fence rolls the entire append back", async () => {
    const b = await seed(); const l = await lease(b);
    // Reproducible expiry mid-transaction; this mutates only synthetic test state.
    await admin.unsafe(`CREATE FUNCTION public.test_expire_during_insert() RETURNS trigger
      LANGUAGE plpgsql SECURITY INVOKER AS $$ BEGIN
        IF NEW.credential_id = '${b.credentialId}'::uuid THEN
          UPDATE public.trader_account_collection_state SET lease_expires_at=clock_timestamp()-interval '1 second'
          WHERE credential_id=NEW.credential_id;
        END IF; RETURN NEW;
      END $$;
      CREATE TRIGGER test_expire_during_insert BEFORE INSERT ON public.trader_account_observations
      FOR EACH ROW EXECUTE FUNCTION public.test_expire_during_insert();`);
    await expect(commit(l)).rejects.toThrow("ACCOUNT_OBSERVATION_STORAGE_FAILED");
    expect((await admin`SELECT count(*) FROM public.trader_account_observations WHERE credential_id=${b.credentialId}`)[0].count).toBe("0");
    expect(await repo.isCurrent(l, 0)).toBe(true);
  });
  it("partial observation retains missing components and is never replaced by zero", async () => {
    const b = await seed(); const l = await lease(b); const o = observation(b);
    const partial: AccountObservation = { ...o, status: "PARTIAL", holdings: null,
      balances: { ...o.balances, status: "ERROR", values: null, error: "TIMEOUT" } };
    expect(await commit(l, partial)).toBe(true);
    expect((await repo.readLatest(b))?.balances.values).toBeNull();
    await admin`UPDATE public.exchange_credentials SET status='revoked' WHERE id=${b.credentialId}`;
    expect(await repo.readLatest(b)).toBeNull();
    expect((await admin`SELECT count(*) FROM public.trader_account_observations WHERE credential_id=${b.credentialId}`)[0].count).toBe("1");
  });
  it("cross-organization INSERT denied by actual RLS, not only a repository WHERE", async () => {
    const b = await seed(); const other = await seed();
    await expect(restricted(b, `INSERT INTO public.trader_account_observations
      (organization_id,credential_id,exchange_account_id,observation_id,credential_revision,configuration_revision,lease_token,payload)
      VALUES ('${other.organizationId}','${other.credentialId}','${other.exchangeAccountId}',
      '${randomUUID()}',1,'config-1','${randomUUID()}','{}')`)).rejects.toThrow("row-level security");
  });
  it("rejects future component timestamps at the storage boundary", async () => {
    const b = await seed(); const l = await lease(b); const o = observation(b);
    const bad = { ...o, balances: { ...o.balances, sourceAsOfMs: o.collectionCompletedAtMs + 1000 } };
    await expect(commit(l, bad)).rejects.toThrow("ACCOUNT_OBSERVATION_STORAGE_FAILED");
  });
  it("local service → real PG17 → Admin/tenant HTTP return the same observation (mock venue/auth)", async () => {
    const b = await seed();
    const service = createAccountObservationService({
      repository: repo, clock: accountObservationClock, newObservationId: randomUUID,
      openReader: async () => ({
        readBalances: async () => ({ binding: b, complete: true, sourceAsOfMs: Date.now(),
          values: [{ asset: "USDT", free: "12.50", locked: "0", total: "12.50" }] }),
        readOpenOrders: async () => ({ binding: b, complete: true, sourceAsOfMs: Date.now(), values: [] }),
        readTrades: async () => ({ binding: b, complete: true, sourceAsOfMs: Date.now(), values: [] }),
        dispose() {},
      }),
    }, { revision: b.configurationRevision, symbols: ["BTCUSDT"], pollIntervalMs: 10000,
      maxBackoffMs: 300000, readTimeoutMs: 1000, leaseTtlMs: 60000 });
    const tick = await service.tick(b, "local-synthetic-venue");
    expect(tick.status).toBe("COMMITTED");
    const dependencies: ObservationReadDependencies = {
      getUserId: async () => "local-test-user", hasTraderAccess: async () => true,
      hasOrgMembership: async (_user, org) => org === b.organizationId,
      hasOperatorAccess: async () => true, resolveActiveBinding: async () => b,
      readLatest: binding => repo.readLatest(binding),
    };
    const req = () => new Request("http://localhost/api/local-observation?" + new URLSearchParams(b));
    const tenant = await handleAccountObservationGet(req(), "tenant", dependencies);
    const operator = await handleAccountObservationGet(req(), "admin", dependencies);
    expect(tenant.status).toBe(200); expect(operator.status).toBe(200);
    const tenantBody = await tenant.json();
    expect(await operator.json()).toEqual(tenantBody);
    expect(tenantBody.balances.values[0].free).toBe("12.50");
    expect(tenantBody).not.toHaveProperty("pnl");
    expect(tenantBody.observationId).toBe(tick.status === "COMMITTED" ? tick.observation.observationId : null);
  });
});
