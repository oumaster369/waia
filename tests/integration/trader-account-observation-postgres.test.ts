import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres, { type Sql } from "postgres";
import { createPostgresObservationRepository } from "@/lib/trader/account-observation/postgres-repository";
import { createPostgresObservationReader } from "@/lib/trader/account-observation/postgres-reader";
import { createAccountObservationService } from "@/lib/trader/account-observation/service";
import { accountObservationClock } from "@/lib/trader/account-observation/clock";
import { createObservationConfiguration, createPostgresAccountObservationRuntime } from "@/lib/trader/account-observation/runtime";
import { openHtxObservationReader } from "@/lib/trader/account-observation/htx-reader-opener";
import { createConfiguredHtxObservationRuntime } from "@/lib/trader/account-observation/configured-runtime";
import { handleAccountObservationGet, type ObservationReadDependencies } from "@/lib/trader/account-observation/read-handler";
import type { AccountObservation, HtxV5AccountObservation, ObservationBinding, ObservationLease } from "@/lib/trader/account-observation/types";
import { accountObservationManifestDigest } from "@/lib/trader/account-observation/assignment-manifest";
import { runAccountObservationCollectionStateProvisioning } from "@/scripts/ops/account-observation-provision-collection-state-v1";

// Deliberately isolated: never fall back to DATABASE_URL_POSTGRES / production env.
const enabled = process.env.DEE960_LOCAL_PG17 === "1";
const url = "postgres://waia_local_admin:local_validation_only@127.0.0.1:55460/waia_dee960_local";
describe.skipIf(!enabled)("DEE-960 actual PostgreSQL 17 fenced observation storage", () => {
  let root: Sql;
  let admin: Sql;
  let client: Sql;
  let readerClient: Sql;
  let readerLogin: string;
  let repo: ReturnType<typeof createPostgresObservationRepository>;
  let reader: ReturnType<typeof createPostgresObservationReader>;
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
    readerLogin = "dee960_v3_reader_" + randomUUID().replaceAll("-", "");
    await admin.unsafe(`CREATE ROLE "${readerLogin}" LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
      PASSWORD 'synthetic_v3_reader';
      GRANT waia_account_observation_reader TO "${readerLogin}" WITH INHERIT FALSE, SET TRUE;`);
    readerClient = postgres(url.replace("waia_local_admin:local_validation_only", `${readerLogin}:synthetic_v3_reader`)
      .replace("/waia_dee960_local", "/" + name),
      { max: 2, connect_timeout: 3, prepare: false, connection: { statement_timeout: 3000 } });
    reader = createPostgresObservationReader(readerClient);
    expect((await readerClient`SELECT session_user`)[0].session_user).toBe(readerLogin);
  }, 30000);
  afterAll(async () => {
    await readerClient?.end({ timeout: 2 }); await client?.end({ timeout: 2 });
    await admin?.end({ timeout: 2 }); await root?.end({ timeout: 2 });
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
  it("configured composition joins distinct restricted pools, store and transport; revoke prevents reopening", async () => {
    const readerLimits = { pageSize: 10, maxPages: 1, maxRecords: 20, maxResponseBytes: 4096, tradeWindowMs: 3600000 };
    const config = createObservationConfiguration({ symbols: ["BTCUSDT"], pollIntervalMs: 1000,
      maxBackoffMs: 8000, readTimeoutMs: 1000, leaseTtlMs: 10000,
      htxCoverage: { ...readerLimits, host: "api.huobi.pro" } });
    const b = { ...await seed("654321"), configurationRevision: config.revision };
    await admin`UPDATE trader_account_collection_state SET configuration_revision=${config.revision}
      WHERE credential_id=${b.credentialId}`;
    const name = String((await admin`SELECT current_database() AS name`)[0].name);
    const login = "dee960_composed_read_" + randomUUID().replaceAll("-", "");
    await admin.unsafe(`CREATE ROLE "${login}" LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
      PASSWORD 'synthetic_composed_reader';
      GRANT waia_account_observation_reader TO "${login}" WITH INHERIT FALSE, SET TRUE;`);
    const readerSql = postgres(`postgres://${login}:synthetic_composed_reader@127.0.0.1:55460/${name}`,
      { max: 2, connect_timeout: 3, prepare: false, connection: { statement_timeout: 3000 } });
    let decrypts = 0; let reads = 0; let commits = 0;
    const configured = [{ binding: b, config, readerLimits }];
    const make = (stop: AbortController) => createConfiguredHtxObservationRuntime({
      collectorSql: client, readerSql, configured, clock: accountObservationClock,
      ownerId: "local-composed-proof", intervalMs: 1000, iterationTimeoutMs: 15000, host: "api.huobi.pro",
      // Test-only provider and HTTP. Actual metadata admission, no key or HTX request.
      protectedCredentialService: { async getDecryptedCredentials(context, id) {
        expect(context.organizationId).toBe(b.organizationId); expect(id).toBe(b.credentialId);
        decrypts++; return { apiKey: "synthetic-key", apiSecret: "synthetic-secret" };
      } },
      async fetchImpl(url, init) {
        expect(init?.method).toBe("GET"); expect(init?.redirect).toBe("error");
        const request = new URL(String(url)); expect(request.origin).toBe("https://api.huobi.pro");
        expect(request.searchParams.get("Signature")).toBeTruthy();
        if (request.pathname === "/v1/account/accounts") return Response.json({ status: "ok",
          data: [{ id: 654321, type: "spot", state: "working" }] });
        if (request.pathname === "/v2/user/uid") return Response.json({ code: 200, data: 456 });
        if (request.pathname === "/v2/user/api-key") return Response.json({ code: 200,
          data: [{ accessKey: "synthetic-key", status: "normal", permission: "readOnly" }] });
        let data: unknown = [];
        if (request.pathname.endsWith("/balance")) { reads++; data = { id: 654321, type: "spot", state: "working",
          list: [{ currency: "usdt", type: "trade", balance: "42" }, { currency: "usdt", type: "frozen", balance: "0" }] }; }
        return new Response(JSON.stringify({ status: "ok", data }));
      }, report(event) { if (event === "COLLECTION_COMMITTED" && ++commits === 2) stop.abort(); },
    });
    try {
      const stop = new AbortController(); const runtime = make(stop);
      expect(decrypts).toBe(0); const safety = setTimeout(() => stop.abort(), 12000);
      try { await runtime.run(stop.signal); } finally { clearTimeout(safety); runtime.dispose(); }
      expect(commits).toBe(2); expect(reads).toBe(2); expect(decrypts).toBe(2);
      expect((await repo.readLatest(b))?.holdings).toEqual([{ asset: "USDT", free: "42", locked: "0", total: "42" }]);
      await admin`UPDATE exchange_credentials SET status='revoked' WHERE id=${b.credentialId}`;
      const after = new AbortController(); const next = make(after); const finish = setTimeout(() => after.abort(), 250);
      try { await next.run(after.signal); } finally { clearTimeout(finish); next.dispose(); }
      expect(decrypts).toBe(2); expect(reads).toBe(2); expect(await repo.readLatest(b)).toBeNull();
      expect((await readerSql`SELECT current_user AS role`)[0].role).toBe(login); // caller-owned pool remains open
    } finally { await readerSql.end({ timeout: 2 }); }
  }, 15000);
  function observation(b: ObservationBinding): AccountObservation {
    const t = Date.now();
    const component = { status: "COMPLETE" as const, values: [], sourceAsOfMs: null,
      readStartedAtMs: t, readCompletedAtMs: t, error: null };
    return { schemaVersion: "account-observation/v1", observationId: randomUUID(), binding: b,
      collectionStartedAtMs: t, collectionCompletedAtMs: t, status: "COMPLETE",
      balances: component, openOrders: component, trades: [{ symbol: "BTCUSDT", component }], holdings: [] };
  }
  function htxV5Projection(t: number): HtxV5AccountObservation {
    const completeValue = <T>(value: T) => ({ status: "COMPLETE" as const, value,
      readStartedAtMs: t, readCompletedAtMs: t, responseGeneratedAtMs: null, error: null });
    const completeRows = <T>(values: readonly T[]) => ({ status: "COMPLETE" as const, values,
      readStartedAtMs: t, readCompletedAtMs: t, responseGeneratedAtMs: null, error: null, pageScope: null });
    return { schemaVersion: "htx-v5-observation/v1", htxUid: "456", assetMode: completeValue("1"),
      balance: completeValue({ state: "normal", account: { equityUsd: "0", initialMarginUsd: "0",
        maintenanceMarginUsd: "0", maintenanceMarginRate: "0", profitUnrealUsd: "0", availableMarginUsd: "0",
        voucherValue: "0", createdTimeMs: null, updatedTimeMs: null }, details: [] }),
      positions: completeRows([{ contractCode: "BTC-USDT", positionSide: "long", direction: "buy", marginMode: "cross",
        volume: "0.123456789012345678", available: "0.111111111111111111", openAveragePrice: "60000.000000000001",
        liquidationPrice: null, initialMargin: "12.000000000000001", maintenanceMargin: "3.000000000000001",
        margin: "15.000000000000002", profitUnreal: "-0.000000000000007", profitRate: "-0.000000000000003",
        marginRate: "0.012345678901234567", marginCurrency: "USDT", lastPrice: "60001.000000000003",
        markPrice: "60002.000000000004", contractType: "swap", createdTimeMs: t, updatedTimeMs: t }]),
      openOrders: { status: "PARTIAL", values: [{ id: "9007199254740993", orderId: "123456789012345678901234",
        contractCode: "BTC-USDT", clientOrderId: "client_v3_order_01", side: "sell", positionSide: "long",
        marginMode: "cross", volume: "0.000000000000000019", state: "partially_filled", reduceOnly: true,
        tpTriggerPrice: "70000.000000000001", slTriggerPrice: null, createdTimeMs: t, updatedTimeMs: null }],
        readStartedAtMs: t, readCompletedAtMs: t,
        responseGeneratedAtMs: null, error: null,
        pageScope: { pageSize: 100, maxPages: 2, pagesRead: 1, nextFrom: null, completeness: "UNKNOWN" } },
      algoOrders: { status: "PARTIAL", values: [{ id: "9007199254740993123", algoId: "algo_12345678901234567890",
        contractCode: "BTC-USDT", volume: "0.000000000000000021", type: "tpsl", state: "active",
        positionSide: "long", side: "sell", marginMode: "cross", tpTriggerPrice: "71000.000000000001",
        slTriggerPrice: "59000.000000000001", reduceOnly: true, createdTimeMs: t, updatedTimeMs: null }],
        readStartedAtMs: t, readCompletedAtMs: t,
        responseGeneratedAtMs: null, error: null, pageScope: { pageSize: 20, maxPagesPerType: 2,
          queries: (["tp", "sl", "tpsl", "trigger", "trailing_stop"] as const)
            .map(type => ({ type, pagesRead: 1, nextFrom: null })),
          completeness: "UNKNOWN" } },
      fills: { status: "PARTIAL", values: [{ id: "9007199254740993123", tradeId: "trade_12345678901234567890",
        orderId: "order_12345678901234567890", contractCode: "BTC-USDT", side: "buy", positionSide: "long",
        orderType: "1", marginMode: "cross", tradePrice: "60001.000000000003",
        tradeVolume: "0.000000000000000023", tradeTurnover: "0.000000001380023000000069",
        tradeFee: "-0.000000000000000007", feeCurrency: "USDT", profit: "0.000000000000000011",
        createdTimeMs: t, updatedTimeMs: t }], readStartedAtMs: t, readCompletedAtMs: t,
        responseGeneratedAtMs: null, error: null, coverage: "CONFIGURED_CONTRACTS_AND_WINDOW", contracts: ["BTC-USDT"],
        windowStartMs: t - 10000, windowEndMs: t,
        pageScope: { pageSize: 100, maxPagesPerContract: 2,
          queries: [{ contractCode: "BTC-USDT", pagesRead: 1, nextFrom: null }], completeness: "UNKNOWN" } } };
  }
  function v3Observation(b: ObservationBinding): AccountObservation {
    const base = observation(b);
    return { ...base, schemaVersion: "account-observation/v3", status: "PARTIAL",
      htxV5: htxV5Projection(base.collectionCompletedAtMs) };
  }
  async function lease(b: ObservationBinding) {
    const l = await repo.claimDue(b, "worker-1", Date.now(), 60000);
    expect(l).not.toBeNull(); return l!;
  }
  function commit(l: ObservationLease, o = observation(l.binding)) {
    const nowMs = Date.now();
    return repo.commitIfCurrent({ lease: l, observation: o, nowMs, nextDueAtMs: nowMs + 10000, consecutiveFailures: 0 });
  }
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
  };
  const within = async <T,>(promise: Promise<T>, label: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([promise, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 8000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  };
  const makeCrossRuntime = (binding: ObservationBinding, config: ReturnType<typeof createObservationConfiguration>,
    ownerId: string, started: { resolve(value: void): void }, response: { promise: Promise<Response> },
    committed: string[]) => {
    const readerLimits = { pageSize: 10, maxPages: 1, maxRecords: 20, maxResponseBytes: 4096, tradeWindowMs: 3600000 };
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new URL(String(input));
      expect(init?.redirect).toBe("error");
      if (request.hostname === "api.hbdm.com") {
        started.resolve();
        return response.promise;
      }
      expect(request.origin).toBe("https://api.huobi.pro");
      if (request.pathname === "/v1/account/accounts") return Response.json({ status: "ok",
        data: [{ id: Number(binding.exchangeAccountId), type: "spot", state: "working" }] });
      if (request.pathname === "/v2/user/uid") return Response.json({ code: 200, data: 456 });
      if (request.pathname === "/v2/user/api-key") return Response.json({ code: 200,
        data: [{ accessKey: "synthetic-key", status: "normal", permission: "readOnly" }] });
      if (request.pathname.endsWith("/balance")) return Response.json({ status: "ok", data: {
        id: Number(binding.exchangeAccountId), type: "spot", state: "working",
        list: [{ currency: "usdt", type: "trade", balance: "42" }, { currency: "usdt", type: "frozen", balance: "0" }] } });
      return Response.json({ status: "ok", data: [] });
    };
    return createConfiguredHtxObservationRuntime({ collectorSql: client, readerSql: readerClient,
      protectedCredentialService: { async getDecryptedCredentials(context, id) {
        expect(context.organizationId).toBe(binding.organizationId); expect(id).toBe(binding.credentialId);
        return { apiKey: "synthetic-key", apiSecret: "synthetic-secret" };
      } }, configured: [{ binding, config, readerLimits }], host: "api.huobi.pro", fetchImpl,
      clock: accountObservationClock, ownerId, intervalMs: 1000, iterationTimeoutMs: 180000,
      report(event) { if (event === "COLLECTION_COMMITTED") committed.push(event); } });
  };
  const heldV5Response = () => Response.json({ code: 200, ts: Date.now(), data: { asset_mode: "1" } });
  const readLease = async (binding: ObservationBinding) => {
    const rows = await admin`SELECT lease_token::text AS token, lease_owner,
      floor(extract(epoch from lease_expires_at) * 1000)::bigint AS expires_ms,
      consecutive_failures FROM public.trader_account_collection_state WHERE credential_id=${binding.credentialId}`;
    expect(rows).toHaveLength(1);
    return rows[0];
  };
  it("holds a shared lease through cancelled V5 settlement before another runtime can claim", async () => {
    const readerLimits = { pageSize: 10, maxPages: 1, maxRecords: 20, maxResponseBytes: 4096, tradeWindowMs: 3600000 };
    const config = createObservationConfiguration({ symbols: ["BTCUSDT"], pollIntervalMs: 1000,
      maxBackoffMs: 8000, readTimeoutMs: 1000, leaseTtlMs: 150000,
      htxCoverage: { ...readerLimits, host: "api.huobi.pro" }, htxV5: { enabled: true, expectedHtxUid: "456" } });
    const binding = { ...await seed("654321"), configurationRevision: config.revision };
    await admin`UPDATE public.trader_account_collection_state SET configuration_revision=${config.revision}
      WHERE credential_id=${binding.credentialId}`;
    const aStarted = deferred<void>(); const bStarted = deferred<void>();
    const heldA = deferred<Response>(); const heldB = deferred<Response>();
    let aSettled = false; let bSettled = false;
    const aResponse = { promise: heldA.promise.then(response => { aSettled = true; return response; }) };
    const bResponse = { promise: heldB.promise.then(response => { bSettled = true; return response; }) };
    const commitsA: string[] = []; const commitsB: string[] = [];
    const stopA = new AbortController(); const stopB = new AbortController();
    const runtimeA = makeCrossRuntime(binding, config, "cross-runtime-A", aStarted, aResponse, commitsA);
    const runtimeB = makeCrossRuntime(binding, config, "cross-runtime-B", bStarted, bResponse, commitsB);
    let runA: Promise<void> | undefined; let runB: Promise<void> | undefined;
    try {
      runA = runtimeA.run(stopA.signal);
      await within(aStarted.promise, "runtime A V5 request");
      const claimed = await readLease(binding);
      expect(claimed.lease_owner).toBe("cross-runtime-A");
      if (typeof claimed.token !== "string" || typeof claimed.lease_owner !== "string")
        throw new Error("expected runtime A lease to be held");
      const leaseA: ObservationLease = { binding, token: claimed.token, ownerId: claimed.lease_owner,
        expiresAtMs: Number(claimed.expires_ms), consecutiveFailures: claimed.consecutive_failures };

      stopA.abort();
      runB = runtimeB.run(stopB.signal);
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(aSettled).toBe(false);
      expect(bSettled).toBe(false);
      const whileASettling = await readLease(binding);
      expect(whileASettling).toMatchObject({ token: leaseA.token, lease_owner: "cross-runtime-A" });
      expect(runA).toBeDefined();
      const aStillPending = await Promise.race([runA!.then(() => false), new Promise<true>(resolve =>
        setTimeout(() => resolve(true), 100))]);
      expect(aStillPending).toBe(true);

      heldA.resolve(heldV5Response());
      await within(runA!, "runtime A settled cancellation");
      expect(aSettled).toBe(true);
      await admin`UPDATE public.trader_account_collection_state SET next_due_at=clock_timestamp()-interval '1 second'
        WHERE credential_id=${binding.credentialId}`;
      await within(bStarted.promise, "runtime B V5 request after A settlement");
      const current = await readLease(binding);
      expect(current).toMatchObject({ lease_owner: "cross-runtime-B" });
      expect(current.token).not.toBe(leaseA.token);
      expect(await commit(leaseA, v3Observation(binding))).toBe(false);
      expect((await readLease(binding)).token).toBe(current.token);
      expect((await repo.readLatest(binding))).toBeNull();
      expect((await admin`SELECT count(*)::int AS n FROM public.trader_account_observations
        WHERE credential_id=${binding.credentialId}`)[0].n).toBe(0);
      expect(commitsA).toHaveLength(0);

      // Force an expiry takeover while B's fetch is still pending. Once B later
      // settles, its stale release and commit must leave C's successor token intact.
      const leaseBRow = current;
      const leaseB: ObservationLease = { binding, token: String(leaseBRow.token), ownerId: String(leaseBRow.lease_owner),
        expiresAtMs: Number(leaseBRow.expires_ms), consecutiveFailures: leaseBRow.consecutive_failures };
      stopB.abort();
      const cStarted = deferred<void>(); const heldC = deferred<Response>();
      const cResponse = { promise: heldC.promise.then(response => response) };
      const commitsC: string[] = []; const stopC = new AbortController();
      const runtimeC = makeCrossRuntime(binding, config, "cross-runtime-C", cStarted, cResponse, commitsC);
      let runC: Promise<void> | undefined;
      try {
        await admin`UPDATE public.trader_account_collection_state SET lease_expires_at=clock_timestamp()-interval '1 second',
          next_due_at=clock_timestamp()-interval '1 second' WHERE credential_id=${binding.credentialId}`;
        runC = runtimeC.run(stopC.signal);
        await within(cStarted.promise, "runtime C V5 request after lease expiry");
        const successor = await readLease(binding);
        expect(successor.lease_owner).toBe("cross-runtime-C");
        expect(successor.token).not.toBe(leaseB.token);

        heldB.resolve(heldV5Response());
        await within(runB!, "runtime B settled after lease expiry");
        expect(bSettled).toBe(true);
        expect((await readLease(binding)).token).toBe(successor.token);
        expect(await commit(leaseB, v3Observation(binding))).toBe(false);
        expect((await readLease(binding)).token).toBe(successor.token);
        expect(await repo.readLatest(binding)).toBeNull();
        expect((await admin`SELECT count(*)::int AS n FROM public.trader_account_observations
          WHERE credential_id=${binding.credentialId}`)[0].n).toBe(0);
        expect(commitsB).toHaveLength(0);
      } finally {
        stopC.abort(); heldC.resolve(heldV5Response()); runtimeC.dispose();
        if (runC) await Promise.allSettled([runC]);
      }
    } finally {
      stopA.abort(); stopB.abort();
      heldA.resolve(heldV5Response()); heldB.resolve(heldV5Response());
      runtimeA.dispose(); runtimeB.dispose();
      await Promise.allSettled([...(runA ? [runA] : []), ...(runB ? [runB] : [])]);
      expect(await repo.readLatest(binding)).toBeNull();
      expect((await admin`SELECT count(*)::int AS n FROM public.trader_account_observations
        WHERE credential_id=${binding.credentialId}`)[0].n).toBe(0);
    }
  }, 30000);
  it("commits v3 through the restricted writer and reads its exact tenant projection through a restricted LOGIN", async () => {
    const b = await seed(); const l = await lease(b); const o = v3Observation(b);
    expect(await commit(l, o)).toBe(true);
    expect(await repo.readLatest(b)).toEqual(o);
    expect(await reader.resolveActiveBinding({ organizationId: b.organizationId,
      credentialId: b.credentialId, exchangeAccountId: b.exchangeAccountId })).toEqual(b);
    expect(await reader.readLatest(b)).toEqual(o);
    expect(await reader.readLatest({ ...b, organizationId: randomUUID() })).toBeNull();
    expect(await reader.readLatest({ ...b, credentialId: randomUUID() })).toBeNull();
    expect(await reader.readLatest({ ...b, exchangeAccountId: "different-account" })).toBeNull();
    expect((await admin`SELECT payload->>'schemaVersion' AS schema_version FROM public.trader_account_observations
      WHERE credential_id=${b.credentialId}`)[0].schema_version).toBe("account-observation/v3");
  });
  it("does not append or advance latest for rotated, revoked, expired, or superseded v3 commits", async () => {
    const expired = await seed(); const expiredLease = await lease(expired);
    await admin`UPDATE public.trader_account_collection_state SET lease_expires_at=clock_timestamp()-interval '1 second'
      WHERE credential_id=${expired.credentialId}`;
    expect(await commit(expiredLease, v3Observation(expired))).toBe(false);
    expect((await admin`SELECT count(*)::int AS n FROM public.trader_account_observations
      WHERE credential_id=${expired.credentialId}`)[0].n).toBe(0);
    expect((await admin`SELECT last_observation_id FROM public.trader_account_collection_state
      WHERE credential_id=${expired.credentialId}`)[0].last_observation_id).toBeNull();
    const successor = await repo.claimDue(expired, "successor-v3", Date.now(), 60000);
    expect(successor).not.toBeNull();
    expect(await commit(expiredLease, v3Observation(expired))).toBe(false);
    const stillEmpty = await admin`SELECT last_observation_id FROM public.trader_account_collection_state
      WHERE credential_id=${expired.credentialId}`;
    expect(stillEmpty[0].last_observation_id).toBeNull();
    const accepted = v3Observation(expired);
    expect(await commit(successor!, accepted)).toBe(true);
    expect(await repo.readLatest(expired)).toEqual(accepted);
    expect(await commit(expiredLease, v3Observation(expired))).toBe(false);
    expect(await repo.readLatest(expired)).toEqual(accepted);
    expect((await admin`SELECT count(*)::int AS n FROM public.trader_account_observations
      WHERE credential_id=${expired.credentialId}`)[0].n).toBe(1);
    expect((await admin`SELECT last_observation_id FROM public.trader_account_collection_state
      WHERE credential_id=${expired.credentialId}`)[0].last_observation_id).toBe(accepted.observationId);

    const rotated = await seed(); const rotatedLease = await lease(rotated);
    await admin`UPDATE public.exchange_credentials SET permission_metadata='synthetic-rotation' WHERE id=${rotated.credentialId}`;
    expect(await commit(rotatedLease, v3Observation(rotated))).toBe(false);
    expect((await admin`SELECT count(*)::int AS n FROM public.trader_account_observations
      WHERE credential_id=${rotated.credentialId}`)[0].n).toBe(0);
    expect((await admin`SELECT last_observation_id FROM public.trader_account_collection_state
      WHERE credential_id=${rotated.credentialId}`)[0].last_observation_id).toBeNull();
    const current = await reader.resolveActiveBinding({ organizationId: rotated.organizationId,
      credentialId: rotated.credentialId, exchangeAccountId: rotated.exchangeAccountId });
    expect(current?.credentialRevision).toBe("2");
    expect(await reader.readLatest(rotated)).toBeNull();
    expect(current && await reader.readLatest(current)).toBeNull();

    const revoked = await seed(); const revokedLease = await lease(revoked);
    await admin`UPDATE public.exchange_credentials SET status='revoked' WHERE id=${revoked.credentialId}`;
    expect(await commit(revokedLease, v3Observation(revoked))).toBe(false);
    expect((await admin`SELECT count(*)::int AS n FROM public.trader_account_observations
      WHERE credential_id=${revoked.credentialId}`)[0].n).toBe(0);
    expect((await admin`SELECT last_observation_id FROM public.trader_account_collection_state
      WHERE credential_id=${revoked.credentialId}`)[0].last_observation_id).toBeNull();
    expect(await reader.readLatest(revoked)).toBeNull();
  });
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
      hasOperatorAccess: async () => true, isAdminListedOrganization: async () => true, resolveActiveBinding: async () => b,
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

  // This suite exercises the current local-validation schema only. It is not evidence
  // that numbered migration 0229 is deployable or that a production role is authorized.
  describe("DEE-1153 synthetic configured futures projection through PostgreSQL", () => {
    const readerLimits = { pageSize: 10, maxPages: 1, maxRecords: 20, maxResponseBytes: 4096, tradeWindowMs: 3600000 };
    let b: ObservationBinding;
    let readerSql: Sql;
    let stored: AccountObservation | null = null;
    let isolatedRow: Record<string, unknown>;
    beforeAll(async () => {
      const config = createObservationConfiguration({ symbols: ["BTCUSDT"], pollIntervalMs: 1000,
        maxBackoffMs: 8000, readTimeoutMs: 1000, leaseTtlMs: 12000,
        htxCoverage: { ...readerLimits, host: "api.huobi.pro" },
        htxDerivativesFamilies: ["usdt_isolated_perpetual"] });
      b = { ...await seed("654321"), configurationRevision: config.revision };
      await admin`UPDATE trader_account_collection_state SET configuration_revision=${config.revision}
        WHERE credential_id=${b.credentialId}`;
      const name = String((await admin`SELECT current_database() AS name`)[0].name);
      const login = "dee1153_read_" + randomUUID().replaceAll("-", "");
      await admin.unsafe(`CREATE ROLE "${login}" LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
        PASSWORD 'synthetic_futures_reader';
        GRANT waia_account_observation_reader TO "${login}" WITH INHERIT FALSE, SET TRUE;`);
      readerSql = postgres(`postgres://${login}:synthetic_futures_reader@127.0.0.1:55460/${name}`,
        { max: 2, connect_timeout: 3, prepare: false, connection: { statement_timeout: 3000 } });
      const configured = [{ binding: b, config, readerLimits }];
      let committed = 0;
      const stop = new AbortController();
      const runtime = createConfiguredHtxObservationRuntime({
        collectorSql: client, readerSql, configured, clock: accountObservationClock,
        ownerId: "local-dee1153-proof", intervalMs: 1000, iterationTimeoutMs: 15000, host: "api.huobi.pro",
        protectedCredentialService: { async getDecryptedCredentials(context, id) {
          expect(context.organizationId).toBe(b.organizationId); expect(id).toBe(b.credentialId);
          return { apiKey: "synthetic-key", apiSecret: "synthetic-secret" };
        } },
        async fetchImpl(input, init) {
          const request = new URL(String(input));
          expect(init?.redirect).toBe("error");
          expect(request.searchParams.get("Signature")).toBeTruthy();
          if (request.hostname === "api.hbdm.com") {
            expect(init?.method).toBe("POST");
            expect(request.pathname).toBe("/linear-swap-api/v1/swap_account_info");
            expect(JSON.parse(String(init?.body))).toEqual({});
            return Response.json({ status: "ok", ts: 1790841600000, data: [{
              contract_code: "BTC-USDT", symbol: "BTC", margin_account: "BTC-USDT", margin_mode: "isolated",
              margin_balance: "7.25000000", margin_available: "5.5", margin_position: "1.75", margin_frozen: "0",
              margin_static: "6.0", profit_real: "-0.2", profit_unreal: "0.15", risk_rate: "0.3",
              liquidation_price: "42000", lever_rate: 10,
            }] });
          }
          expect(request.origin).toBe("https://api.huobi.pro"); expect(init?.method).toBe("GET");
          if (request.pathname === "/v1/account/accounts") return Response.json({ status: "ok",
            data: [{ id: 654321, type: "spot", state: "working" }] });
          if (request.pathname === "/v2/user/uid") return Response.json({ code: 200, data: 456 });
          if (request.pathname === "/v2/user/api-key") return Response.json({ code: 200,
            data: [{ accessKey: "synthetic-key", status: "normal", permission: "readOnly" }] });
          const data = request.pathname.endsWith("/balance") ? { id: 654321, type: "spot", state: "working",
            list: [{ currency: "usdt", type: "trade", balance: "42" }, { currency: "usdt", type: "frozen", balance: "0" }] } : [];
          return Response.json({ status: "ok", data });
        },
        report(event) { if (event === "COLLECTION_COMMITTED" && ++committed === 1) stop.abort(); },
      });
      const timeout = setTimeout(() => stop.abort(), 12000);
      try { await runtime.run(stop.signal); } finally { clearTimeout(timeout); runtime.dispose(); }
      expect(committed).toBe(1);
      const sqlReader = createPostgresObservationReader(readerSql);
      stored = await sqlReader.readLatest(b);
      expect(stored?.schemaVersion).toBe("account-observation/v2");
      expect(stored?.derivatives?.families).toHaveLength(4);
      isolatedRow = stored!.derivatives!.families.find(item => item.family === "usdt_isolated_perpetual")!.accounts![0] as unknown as Record<string, unknown>;
    }, 20000);
    afterAll(async () => { await readerSql?.end({ timeout: 2 }); });

    const makeDeps = (): ObservationReadDependencies => {
      const sqlReader = createPostgresObservationReader(readerSql);
      return {
        getUserId: async () => "local-dee1153-user", hasTraderAccess: async () => true,
        hasOrgMembership: async (_user, org) => org === b.organizationId,
        hasOperatorAccess: async () => true, isAdminListedOrganization: async org => org === b.organizationId,
        resolveActiveBinding: scope => sqlReader.resolveActiveBinding(scope),
        readLatest: binding => sqlReader.readLatest(binding),
      };
    };
    const requestFor = (binding: ObservationBinding) => new Request(
      "http://localhost/api/local-observation?" + new URLSearchParams(binding));

    it("persists and parses the configured family through JSONB, with tenant/Admin response parity", async () => {
      expect(stored?.derivatives?.families.find(item => item.family === "usdt_isolated_perpetual"))
        .toMatchObject({ status: "COMPLETE", accounts: [isolatedRow] });
      expect(isolatedRow).toMatchObject({ collateralAsset: "USDT", marginBalance: "7.25000000", unrealizedPnl: "0.15" });
      const deps = makeDeps();
      const tenant = await handleAccountObservationGet(requestFor(b), "tenant", deps);
      const adminResponse = await handleAccountObservationGet(requestFor(b), "admin", deps);
      expect(tenant.status).toBe(200); expect(adminResponse.status).toBe(200);
      expect(await adminResponse.json()).toEqual(await tenant.json());
    });
    it("refuses another tenant and stale credential/configuration bindings", async () => {
      const deps = makeDeps();
      expect((await handleAccountObservationGet(requestFor({ ...b, organizationId: randomUUID() }), "tenant", deps)).status).toBe(403);
      expect((await handleAccountObservationGet(requestFor({ ...b, credentialRevision: "2" }), "tenant", deps)).status).toBe(403);
      expect((await handleAccountObservationGet(requestFor({ ...b, configurationRevision: "stale-config" }), "tenant", deps)).status).toBe(403);
    });
    it("hides a retained derivative projection immediately after credential revocation", async () => {
      await admin`UPDATE exchange_credentials SET status='revoked' WHERE id=${b.credentialId}`;
      expect(await createPostgresObservationReader(readerSql).readLatest(b)).toBeNull();
      expect((await handleAccountObservationGet(requestFor(b), "admin", makeDeps())).status).toBe(403);
      const retained = await admin`SELECT payload FROM trader_account_observations WHERE credential_id=${b.credentialId}`;
      expect(retained).toHaveLength(1);
      expect(retained[0].payload.derivatives.families[0].accounts[0].marginBalance).toBe("7.25000000");
    });
  });
});

// DEE-1015: bootstrap authority for the initial collection-state row, proved against actual
// 0205-equivalent grants and FORCE ROW LEVEL SECURITY rather than a fabricated Sql double.
describe.skipIf(!enabled)("DEE-1015 actual PostgreSQL 17 collection-state provisioning", () => {
  const RELEASE_SHA = "1eaa73cd134e1bc104b0f4fefa4e1e5c9f08e801";
  const READER_LIMITS = {
    pageSize: 100,
    maxPages: 2,
    maxRecords: 200,
    maxResponseBytes: 262144,
    tradeWindowMs: 86400000,
  };
  let root: Sql;
  let admin: Sql;
  let collector: Sql;
  let databaseUrl: string;
  let manifestDirectory: string;
  const openings: Sql[] = [];

  /** Fresh client per invocation: the operator owns and closes whatever it is given. */
  const connect = (url: string) => {
    const sql = postgres(url, { max: 1, connect_timeout: 3, prepare: false, onnotice: () => {} });
    openings.push(sql);
    return sql;
  };

  beforeAll(async () => {
    root = postgres(url, { max: 1, connect_timeout: 3, prepare: false });
    const name = "dee1015_" + randomUUID().replaceAll("-", "");
    await root.unsafe('CREATE DATABASE "' + name + '"');
    databaseUrl = url.replace("/waia_dee960_local", "/" + name);
    admin = postgres(databaseUrl, { max: 5, connect_timeout: 3, prepare: false });
    await admin.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dee1015_local_owner') THEN
        CREATE ROLE dee1015_local_owner NOLOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    END $$;
    GRANT USAGE, CREATE ON SCHEMA public TO dee1015_local_owner WITH GRANT OPTION;`);
    await admin.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE dee1015_local_owner");
      await tx.unsafe("CREATE TABLE public.organizations (id uuid PRIMARY KEY)");
      await tx.unsafe(
        readFileSync("db/migrations_postgres/0006_exchange_credentials.sql", "utf8").replaceAll(
          "--> statement-breakpoint",
          "",
        ),
      );
      await tx.unsafe(
        readFileSync("db/migrations_postgres/0007_exchange_credentials_rls.sql", "utf8"),
      );
      await tx.unsafe(readFileSync("db/local-validation/dee960-account-observation.sql", "utf8"));
    });
    // A separately provisioned recurring collector LOGIN, exactly as production would grant it.
    await admin.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dee1015_local_collector') THEN
        CREATE ROLE dee1015_local_collector LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
          NOCREATEDB NOCREATEROLE PASSWORD 'local_validation_only';
      END IF;
    END $$;
    GRANT waia_account_observer TO dee1015_local_collector;`);
    collector = postgres(databaseUrl.replace("waia_local_admin:", "dee1015_local_collector:"), {
      max: 2,
      connect_timeout: 3,
      prepare: false,
      connection: { statement_timeout: 3000 },
    });
    expect((await collector`SELECT session_user`)[0].session_user).toBe("dee1015_local_collector");
    manifestDirectory = mkdtempSync(join(tmpdir(), "dee1015-manifest-"));
  }, 30000);

  afterAll(async () => {
    await Promise.all(openings.map((sql) => sql.end({ timeout: 2 }).catch(() => {})));
    await collector?.end({ timeout: 2 });
    await admin?.end({ timeout: 2 });
    await root?.end({ timeout: 2 });
    // Retain the isolated synthetic database for diagnosis. Never drop a user database.
  });

  async function seedCredential(): Promise<{
    organizationId: string;
    credentialId: string;
    exchangeAccountId: string;
  }> {
    const identity = {
      organizationId: randomUUID(),
      credentialId: randomUUID(),
      exchangeAccountId: String(10_000_000 + Math.floor(Math.random() * 1_000_000)),
    };
    await admin`INSERT INTO public.organizations VALUES (${identity.organizationId})`;
    await admin`INSERT INTO public.exchange_credentials
      (id, organization_id, venue, exchange_account_id, encrypted_payload)
      VALUES (${identity.credentialId}, ${identity.organizationId}, 'htx',
        ${identity.exchangeAccountId}, 'synthetic-not-a-key')`;
    return identity;
  }

  /** Writes a real sealed manifest to disk, exactly as an operator would hand one over. */
  function writeManifest(
    identity: Readonly<{ organizationId: string; credentialId: string; exchangeAccountId: string }>,
    overrides: Partial<{ symbols: string[]; credentialRevision: string }> = {},
  ) {
    const symbols = overrides.symbols ?? ["BTCUSDT"];
    const config = createObservationConfiguration({
      symbols,
      pollIntervalMs: 60000,
      maxBackoffMs: 300000,
      readTimeoutMs: 10000,
      leaseTtlMs: 120000,
      htxCoverage: { ...READER_LIMITS, host: "api.huobi.pro" },
    });
    const body = {
      schemaVersion: "waia.account_observation_assignment_manifest.v1" as const,
      releaseSha: RELEASE_SHA,
      host: "api.huobi.pro" as const,
      intervalMs: 60000,
      iterationTimeoutMs: 300000,
      openTimeoutMs: 15000,
      shutdownTimeoutMs: 10000,
      assignments: [
        {
          ...identity,
          credentialRevision: overrides.credentialRevision ?? "1",
          configurationRevision: config.revision,
          symbols,
          pollIntervalMs: 60000,
          maxBackoffMs: 300000,
          readTimeoutMs: 10000,
          leaseTtlMs: 120000,
          readerLimits: READER_LIMITS,
        },
      ],
    };
    const digest = accountObservationManifestDigest(body);
    const path = join(manifestDirectory, `${randomUUID()}.json`);
    writeFileSync(path, JSON.stringify({ ...body, contentSha256: digest }), "utf8");
    return { path, digest, configurationRevision: config.revision, symbols };
  }

  function provision(
    identity: Readonly<{ organizationId: string; credentialId: string; exchangeAccountId: string }>,
    manifest: Readonly<{ path: string; digest: string }>,
    overrides: Partial<{ verifyOnly: boolean; databaseUrl: string }> = {},
  ) {
    return runAccountObservationCollectionStateProvisioning(
      {
        manifestPath: manifest.path,
        expectedManifestSha256: manifest.digest,
        expectedReleaseSha: RELEASE_SHA,
        ...identity,
        confirmedAssignment: `${identity.organizationId}:${identity.credentialId}:${identity.exchangeAccountId}`,
        verifyOnly: overrides.verifyOnly ?? false,
        databaseUrl: overrides.databaseUrl ?? databaseUrl,
      },
      { connect },
    );
  }

  const stateRows = (credentialId: string) =>
    admin`SELECT configuration_revision, symbols, consecutive_failures, lease_token, lease_owner,
      lease_expires_at, last_observation_id, next_due_at
      FROM public.trader_account_collection_state WHERE credential_id = ${credentialId}`;

  it("provisions exactly one usable row, then is idempotent on an exact retry", async () => {
    const identity = await seedCredential();
    const manifest = writeManifest(identity);

    const receipt = await provision(identity, manifest);
    expect(receipt.classification).toBe("PROVISIONED");
    expect(receipt.configurationRevision).toBe(manifest.configurationRevision);
    expect(receipt.provisioningIdentity.currentUser).toBe("waia_local_admin");
    expect(Number(receipt.provisioningIdentity.serverVersionNum)).toBeGreaterThanOrEqual(170000);

    const rows = await stateRows(identity.credentialId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      configuration_revision: manifest.configurationRevision,
      symbols: ["BTCUSDT"],
      consecutive_failures: 0,
      lease_token: null,
      lease_owner: null,
      lease_expires_at: null,
      last_observation_id: null,
    });

    const retry = await provision(identity, manifest);
    expect(retry.classification).toBe("ALREADY_PROVISIONED");
    expect(retry.contentDigestHex).not.toBe(receipt.contentDigestHex); // classification differs
    expect(await stateRows(identity.credentialId)).toHaveLength(1);
  }, 20000);

  it("hands the recurring collector a row it can actually lease", async () => {
    const identity = await seedCredential();
    const manifest = writeManifest(identity);
    await provision(identity, manifest);

    const binding = {
      ...identity,
      credentialRevision: "1",
      configurationRevision: manifest.configurationRevision,
    };
    const lease = await createPostgresObservationRepository(collector).claimDue(
      binding,
      "dee1015-provisioned-proof",
      Date.now(),
      60000,
    );

    expect(lease).not.toBeNull();
  }, 20000);

  it("verifies without writing, then writes on a later apply", async () => {
    const identity = await seedCredential();
    const manifest = writeManifest(identity);

    const verified = await provision(identity, manifest, { verifyOnly: true });
    expect(verified.classification).toBe("VERIFIED");
    expect(verified.mode).toBe("VERIFY_ONLY");
    expect(await stateRows(identity.credentialId)).toHaveLength(0);

    expect((await provision(identity, manifest)).classification).toBe("PROVISIONED");
    expect(await stateRows(identity.credentialId)).toHaveLength(1);
  }, 20000);

  it("refuses a conflicting existing row instead of rewriting authority", async () => {
    const identity = await seedCredential();
    const original = writeManifest(identity);
    await provision(identity, original);

    const changed = writeManifest(identity, { symbols: ["BTCUSDT", "ETHUSDT"] });
    expect(changed.configurationRevision).not.toBe(original.configurationRevision);

    await expect(provision(identity, changed)).rejects.toThrow(/REFUSED:CONFLICTING_STATE/);
    const rows = await stateRows(identity.credentialId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      configuration_revision: original.configurationRevision,
      symbols: ["BTCUSDT"],
    });
  }, 20000);

  it("refuses a revoked credential and writes nothing", async () => {
    const identity = await seedCredential();
    const manifest = writeManifest(identity);
    await admin`UPDATE public.exchange_credentials SET status='revoked' WHERE id=${identity.credentialId}`;

    await expect(provision(identity, manifest)).rejects.toThrow(/REFUSED:CREDENTIAL_NOT_ACTIVE/);
    expect(await stateRows(identity.credentialId)).toHaveLength(0);
  }, 20000);

  it("refuses a rotated credential revision the manifest no longer matches", async () => {
    const identity = await seedCredential();
    const manifest = writeManifest(identity);
    // The database owns this counter; a real field change bumps it past the sealed value.
    await admin`UPDATE public.exchange_credentials SET permission_metadata='rotated'
      WHERE id=${identity.credentialId}`;
    expect(
      (
        await admin`SELECT observation_revision FROM public.exchange_credentials
        WHERE id=${identity.credentialId}`
      )[0].observation_revision,
    ).toBe("2");

    await expect(provision(identity, manifest)).rejects.toThrow(
      /REFUSED:CREDENTIAL_REVISION_MISMATCH/,
    );
    expect(await stateRows(identity.credentialId)).toHaveLength(0);
  }, 20000);

  it("refuses an organization or account that does not own the credential", async () => {
    const identity = await seedCredential();
    const other = await seedCredential();

    const crossOrganization = { ...identity, organizationId: other.organizationId };
    await expect(provision(crossOrganization, writeManifest(crossOrganization))).rejects.toThrow(
      /REFUSED:CREDENTIAL_ORGANIZATION_MISMATCH/,
    );

    const crossAccount = { ...identity, exchangeAccountId: other.exchangeAccountId };
    await expect(provision(crossAccount, writeManifest(crossAccount))).rejects.toThrow(
      /REFUSED:CREDENTIAL_ACCOUNT_MISMATCH/,
    );
    expect(await stateRows(identity.credentialId)).toHaveLength(0);
  }, 20000);

  it("refuses a credential that does not exist at all", async () => {
    const absent = {
      organizationId: randomUUID(),
      credentialId: randomUUID(),
      exchangeAccountId: "19191919",
    };
    await expect(provision(absent, writeManifest(absent))).rejects.toThrow(
      /REFUSED:CREDENTIAL_NOT_FOUND/,
    );
  }, 20000);

  it("proves the recurring collector role has no bootstrap INSERT authority", async () => {
    const identity = await seedCredential();
    const manifest = writeManifest(identity);

    const privileges = await admin`
      SELECT has_table_privilege('waia_account_observer', 'public.trader_account_collection_state', 'INSERT') AS collector_insert,
        has_any_column_privilege('waia_account_observer', 'public.trader_account_collection_state', 'INSERT') AS collector_column_insert,
        has_table_privilege('waia_account_observation_reader', 'public.trader_account_collection_state', 'INSERT') AS reader_insert,
        has_table_privilege('waia_account_observer', 'public.trader_account_collection_state', 'SELECT') AS collector_select,
        has_table_privilege('waia_account_observer', 'public.trader_account_observations', 'INSERT') AS collector_observation_insert`;
    expect(privileges[0]).toMatchObject({
      collector_insert: false,
      collector_column_insert: false,
      reader_insert: false,
      // Unchanged existing authority: read state, append immutable observations.
      collector_select: true,
      collector_observation_insert: true,
    });

    // The collector cannot bootstrap its own row even with the correct RLS scope settings.
    await expect(
      admin.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE waia_account_observer");
        await tx`SELECT set_config('waia.observation_org', ${identity.organizationId}, true),
          set_config('waia.observation_credential', ${identity.credentialId}, true),
          set_config('waia.observation_account', ${identity.exchangeAccountId}, true)`;
        return tx`INSERT INTO public.trader_account_collection_state
          (organization_id, credential_id, exchange_account_id, configuration_revision, symbols)
          VALUES (${identity.organizationId}, ${identity.credentialId},
            ${identity.exchangeAccountId}, ${manifest.configurationRevision}, '["BTCUSDT"]')`;
      }),
    ).rejects.toThrow(/permission denied/);
    expect(await stateRows(identity.credentialId)).toHaveLength(0);

    // Only the explicit operator boundary provisions it.
    expect((await provision(identity, manifest)).classification).toBe("PROVISIONED");
  }, 20000);

  it("refuses provisioning through the collector runtime login", async () => {
    const identity = await seedCredential();
    const manifest = writeManifest(identity);
    // Refused on identity before a connection is ever attempted, so no runtime login is needed.
    await expect(
      provision(identity, manifest, {
        databaseUrl: databaseUrl.replace("waia_local_admin:", "waia_account_observer_login:"),
      }),
    ).rejects.toThrow(/REFUSED:PROVISIONING_ROLE_IS_RUNTIME_LOGIN/);
    expect(await stateRows(identity.credentialId)).toHaveLength(0);
  }, 20000);

  it("refuses a role that has INSERT but cannot pass forced row level security", async () => {
    const identity = await seedCredential();
    const manifest = writeManifest(identity);
    const login = "dee1015_insert_only_" + randomUUID().replaceAll("-", "");
    await admin.unsafe(`CREATE ROLE "${login}" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
      PASSWORD 'local_validation_only';
      GRANT USAGE ON SCHEMA public TO "${login}";
      GRANT INSERT, SELECT ON public.trader_account_collection_state TO "${login}";
      GRANT SELECT ON public.exchange_credentials TO "${login}";`);

    // Fails closed on the attestation rather than silently producing an RLS-filtered write.
    await expect(
      provision(identity, manifest, {
        databaseUrl: databaseUrl.replace("waia_local_admin:", `${login}:`),
      }),
    ).rejects.toThrow(/REFUSED:PROVISIONING_AUTHORITY_INSUFFICIENT/);
    expect(await stateRows(identity.credentialId)).toHaveLength(0);
  }, 20000);

  it("refuses a substituted manifest before opening any connection", async () => {
    const identity = await seedCredential();
    const manifest = writeManifest(identity);
    const substituted = writeManifest(identity, { symbols: ["ETHUSDT"] });

    await expect(
      provision(identity, { path: substituted.path, digest: manifest.digest }),
    ).rejects.toThrow(/MANIFEST_REFUSED:EXPECTED_DIGEST/);
    expect(await stateRows(identity.credentialId)).toHaveLength(0);
  }, 20000);

  it("never mutates immutable observation history", async () => {
    const identity = await seedCredential();
    await provision(identity, writeManifest(identity));

    const before = await admin`SELECT count(*)::int AS n FROM public.trader_account_observations`;
    await provision(identity, writeManifest(identity));
    const after = await admin`SELECT count(*)::int AS n FROM public.trader_account_observations`;

    expect(after[0].n).toBe(before[0].n);
  }, 20000);
});
