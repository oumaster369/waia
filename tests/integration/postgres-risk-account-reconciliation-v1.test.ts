// Observation-only DEE-1135 component. No profile activation, current basis or order authority.
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import { createHtxAccountAcquisitionGetTransport } from "@/lib/trader/account-observation/htx-get-transport";
import type { ObservationClock } from "@/lib/trader/account-observation/types";
import { createEncryptedReferenceRawStoreV1, type PrivateRawObjectStoreV1 } from "@/lib/trader/mi/htx-reference-quote-collector-v1";
import type { MasterKeyProvider } from "@/lib/trader/security/master-key-provider";
import { acquireHtxAccountV1Postgres, createHtxAccountAcquisitionJobV1, readHtxAccountAcquisitionV1Postgres,
  type HtxAccountAcquisitionJobV1 } from "@/lib/trader/reality/v2/htx-account-acquisition-postgres";
import { decodeHtxAccountAcquisitionPageV1,
  type HtxAccountAcquisitionSpecV1 } from "@/lib/trader/reality/v2/htx-account-acquisition-v1";
import { createRiskAccountProfileV1, createRiskAccountReferenceV1, riskAccountDigestV1,
  sealRiskAccountRecordV1, RISK_ACCOUNT_CHANNELS_V1, RISK_REFERENCE_METHOD_V1,
  type RiskReferenceMemberV1 } from "@/lib/trader/risk/v2/risk-account-source-profile-v1";

const enabled = process.env.WAIA_PG_INTEGRATION === "1", url = process.env.DATABASE_URL_POSTGRES?.trim();
const receipt = (stage: string, body: unknown) => console.log(JSON.stringify({ kind: "DEE1135_ACQUISITION_RECEIPT", stage, body }));
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const clock: ObservationClock = { now: () => Date.now(), sleep: (ms, signal) => new Promise((resolve, reject) => {
  const stop = () => { clearTimeout(timer); reject(new Error("ABORTED")); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms);
  signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop();
}) };
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
function errorShape(value: unknown, depth = 0): unknown {
  if (depth > 5 || !value || typeof value !== "object") return String(value);
  const e = value as { name?: string; message?: string; code?: string; cause?: unknown };
  // Synthetic inputs only; no connection URI or credential is included.
  return { name: e.name, message: e.message, code: e.code, ...(e.cause ? { cause: errorShape(e.cause, depth + 1) } : {}) };
}
function errorCodes(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const e = value as { code?: string; cause?: unknown };
  return [...(e.code ? [e.code] : []), ...errorCodes(e.cause)];
}
type Client = { sql: postgres.Sql; db: WaiaPostgresDb; pid: number; name: string; closed: boolean; queries: string[] };
const clients: Client[] = [], directories: string[] = [];
async function connect(name: string): Promise<Client> {
  const queries: string[] = [];
  const sql = postgres(url!, { max: 1, prepare: false, connect_timeout: 10,
    connection: { application_name: `dee1135-acquisition-${name}`, statement_timeout: 30000, lock_timeout: 5000 },
    debug: (_connection, query) => { queries.push(query); } });
  const db = drizzle(sql, { schema });
  const client = { sql, db, pid: 0, name, closed: false, queries }; clients.push(client);
  const row = (await sql`SELECT pg_backend_pid() AS pid,current_database() AS database,current_user AS role,
    current_setting('server_version_num') AS version,current_setting('statement_timeout') AS statement_timeout,
    current_setting('lock_timeout') AS lock_timeout,current_setting('session_replication_role') AS replication_role`)[0]!;
  client.pid = Number(row.pid);
  expect(row).toMatchObject({ role: "waia_validate", version: "160014", statement_timeout: "30s", lock_timeout: "5s", replication_role: "origin" });
  expect(String(row.database)).toMatch(/^waia_dee1121_dee1135_acquisition_[a-z0-9_]+$/);
  receipt("client-open", { ...row, name }); return client;
}
async function close(client: Client) { if (!client.closed) { await client.sql.end({ timeout: 5 }); client.closed = true; } }
const master = randomBytes(32);
const testProvider: MasterKeyProvider = { isProductionReady: () => false, getCurrentKeyVersion: () => "TEST_ONLY",
  async encryptDataKey(key) {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", master, iv);
    return { keyVersion: "TEST_ONLY", wrappedKey: Buffer.concat([iv, cipher.update(key), cipher.final(), cipher.getAuthTag()]).toString("base64") };
  }, async decryptDataKey(value) {
    if (value.keyVersion !== "TEST_ONLY") throw new Error("TEST_KEY_VERSION");
    const wrapped = Buffer.from(value.wrappedKey, "base64"); if (wrapped.length !== 60) throw new Error("TEST_WRAP_LENGTH");
    const cipher = createDecipheriv("aes-256-gcm", master, wrapped.subarray(0, 12)); cipher.setAuthTag(wrapped.subarray(44));
    return Buffer.concat([cipher.update(wrapped.subarray(12, 44)), cipher.final()]);
  } };
type Fixture = { job: HtxAccountAcquisitionJobV1; store: PrivateRawObjectStoreV1; directory: string };
let owner: Client, controller: Client, organizationId: string, sourceId: string, actorId: string, auditId: string;

async function fixture(options: { pages?: number; pageSize?: number; members?: number } = {}): Promise<Fixture> {
  const accountId = `inactive-component-${randomUUID()}`, acquisitionId = randomUUID(), now = Date.now() - 2000;
  const from = new Date(now - 60000).toISOString(), until = new Date(now + 3600000).toISOString();
  const rawEvidence = { sourceId, captureReceiptDigest: hash("INACTIVE_FIXTURE_CAPTURE"), storageBindingDigest: hash("INACTIVE_FIXTURE_STORAGE"),
    validationReceiptDigest: hash("INACTIVE_FIXTURE_VALIDATION"), rawBytesDigest: hash("INACTIVE_FIXTURE_RAW") };
  const profile = createRiskAccountProfileV1({ organizationId, accountId, credentialId: actorId, exchangeAccountId: "135",
    accountSourceId: sourceId, venue: "HTX", market: "SPOT", referenceCurrency: "USDT", assets: ["BTC", "USDT"],
    instruments: [{ instrumentIdentityDigestHex: hash("BTC/USDT"), symbol: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT", referenceSourceId: sourceId }],
    strategyId: "INACTIVE_FK_FIXTURE_ONLY", strategyVersion: "v1",
    sourceContract: { evidence: rawEvidence, statementDigest: hash("UNQUALIFIED_FIXTURE_CONTRACT"),
      anchorMethod: "INDEPENDENT_SOURCE_ASSERTED_DATED_ACCOUNT", validFromUtc: from, validUntilUtc: until,
      maxSourceAgeMs: 60000, maxReportClockSkewMs: 0, coveredAssetSetDigest: riskAccountDigestV1(["BTC", "USDT"]) },
    mutationBounds: ["BTC", "USDT"].flatMap(asset => RISK_ACCOUNT_CHANNELS_V1.map(channel => ({ asset, channel,
      intervalStartUtc: from, intervalEndUtc: until, maximumPositiveQuantity: "1", maximumNegativeQuantity: "1",
      contractStatementDigest: hash("UNQUALIFIED_FIXTURE_CONTRACT") }))),
    reference: { qualification: { evidence: rawEvidence, statementDigest: hash("UNQUALIFIED_FIXTURE_METHOD"), methodVersion: RISK_REFERENCE_METHOD_V1,
      validFromUtc: from, validUntilUtc: until, reportTimeSemantics: "HTX_RESPONSE_GENERATION_WITH_QUALIFIED_SIDE_AGE_BOUND", venueDependence: "SINGLE_VENUE_HTX" },
      windowDurationMs: 1000, slotOffsetsMs: [0, 500], slotToleranceMs: 0, maxSideAgeMs: 10, validityMs: 60000 },
    allocation: { evidence: rawEvidence, statementDigest: hash("NOT_AN_ADOPTED_CAP"), allocationId: "INACTIVE_FIXTURE_ONLY", version: "v1",
      approvedNotional: "1", allowedSymbols: ["BTC/USDT"], validFromUtc: from, validUntilUtc: until },
    governance: { coolingOffMs: 1, reviewReason: "Root-admitted inactive FK fixture; no authority/activation" },
    work: { maxRawBytes: 1048576, requestTimeoutMs: 2000, maxPages: options.pages ?? 20, maxMembers: options.members ?? 100,
      maxLedgerEvents: 20, retentionSeconds: 3600 } });
  const members: RiskReferenceMemberV1[] = [0, 1].map(slot => sealRiskAccountRecordV1({ schemaVersion: "risk-reference-member/v1" as const,
    organizationId, accountId, profileDigest: profile.contentDigest, windowId: acquisitionId, slot,
    instrumentIdentityDigestHex: hash("BTC/USDT"), symbol: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT" as const,
    ...rawEvidence, sourceReportTimeUtc: new Date(now + slot * 500).toISOString(), availableAtUtc: new Date(now + slot * 500).toISOString(),
    rawMemberPath: "tick" as const, decoderVersion: "htx-merged-lossless-scale8/v1", normalizedInputDigest: hash(`normal${slot}`),
    gatewayReceiptDigest: hash(`gateway${slot}`), observationId: hash(`observation${slot}`), observationContentDigest: hash(`content${slot}`),
    trustAsOfReceiptId: hash(`trust${slot}`), bid: "9", ask: "10", last: "11" }));
  const reference = createRiskAccountReferenceV1({ profile, windowId: acquisitionId,
    windowStartUtc: new Date(now).toISOString(), assembledAtUtc: new Date(now + 1000).toISOString(), members });
  const { contentDigest: profileDigest, ...profileBody } = profile, { contentDigest: referenceDigest, ...referenceBody } = reference;
  await owner.db.insert(schema.traderRiskAccountProfilesV1).values({ organizationId, accountId, contentDigest: profileDigest,
    bodyText: canonicalJsonString(profileBody), actorId, auditId });
  await owner.db.insert(schema.traderRiskAccountReferencesV1).values({ organizationId, accountId, contentDigest: referenceDigest,
    bodyText: canonicalJsonString(referenceBody), profileDigest, windowId: acquisitionId });
  const spec: HtxAccountAcquisitionSpecV1 = { acquisitionId, accountId,
    binding: { organizationId, credentialId: actorId, exchangeAccountId: "135", credentialRevision: "1", configurationRevision: "INACTIVE_FIXTURE" },
    sourceId, profileDigest, referenceDigest, assets: ["BTC", "USDT"], symbols: ["BTC/USDT"], knownOrders: [{ orderId: "999", symbol: "BTC/USDT" }],
    historyStartUtc: from, historyEndUtc: new Date(now).toISOString(), pageSize: options.pageSize ?? 2,
    maxPages: profile.work.maxPages, maxMembers: profile.work.maxMembers, maxRawBytes: profile.work.maxRawBytes,
    requestTimeoutMs: profile.work.requestTimeoutMs, retentionSeconds: profile.work.retentionSeconds };
  const job = createHtxAccountAcquisitionJobV1({ schemaVersion: "risk-account-acquisition-job/v1", organizationId, accountId,
    id: acquisitionId, profileDigest, referenceDigest, spec, expected: { currentRevision: "1", riskStateVersion: "0",
      riskEventHeadDigest: null, realityProjectionId: "NO_REALITY_AUTHORITY", realityFrontierHeadDigest: null } });
  const { contentDigest, ...body } = job;
  await owner.db.insert(schema.traderRiskAccountAcquisitionJobsV1).values({ organizationId, accountId, contentDigest,
    bodyText: canonicalJsonString(body), id: acquisitionId, profileDigest, referenceDigest });
  const directory = await mkdtemp(join(homedir(), ".waia-dee1135-acquisition-test-")); directories.push(directory);
  const store = await createEncryptedReferenceRawStoreV1({ directory, masterKeyProvider: testProvider, maxStoredObjects: 128, maxStoredBytes: 33554432 });
  return { job, store, directory };
}
function transport(f: Fixture, options: { invalid?: boolean; beforeResponse?: () => Promise<void>; largePages?: boolean } = {}) {
  let calls = 0, ordinaryPage = 0;
  const spec = f.job.spec;
  const handle = createHtxAccountAcquisitionGetTransport({ binding: spec.binding, symbols: ["BTCUSDT"], knownOrderIds: ["999"],
    apiKey: "SYNTHETIC_COMPONENT_KEY", apiSecret: "SYNTHETIC_COMPONENT_SECRET", host: "api.huobi.pro", clock,
    timeoutMs: spec.requestTimeoutMs, verifyReadAdmission: async () => true,
    fetchImpl: async address => {
      calls++; await options.beforeResponse?.();
      const request = new URL(String(address)); expect(request.origin).toBe("https://api.huobi.pro");
      const created = Date.parse(spec.historyEndUtc) - 1;
      let data: unknown = [];
      if (request.pathname.endsWith("/balance")) data = { id: 135, type: "spot", state: "working", list: [
        { currency: "btc", type: "trade", balance: "2" }, { currency: "btc", type: "frozen", balance: "0" },
        { currency: "usdt", type: "trade", balance: "100" }, { currency: "usdt", type: "frozen", balance: "0" }] };
      if (options.invalid && request.pathname.endsWith("/opening")) data = [{ accountId: 135, clientOrderId: "invalid-chronology",
        symbol: "btcusdt", orderType: "market", orderSide: "buy", orderPrice: "0", orderValue: "1", orderStatus: "created",
        orderOrigTime: created, lastActTime: created - 1000 }];
      if (request.pathname.endsWith("/matchresults")) data = [{ "order-id": 999, "trade-id": "123456", symbol: "btcusdt",
        type: "buy-limit", price: "10", "filled-amount": "1", "filled-fees": "0", "filled-points": "0", "fee-currency": "usdt", "created-at": created }];
      if (options.largePages && request.pathname.endsWith("/openOrders")) {
        ordinaryPage++; data = Array.from({ length: spec.pageSize }, (_, i) => ({ id: String(ordinaryPage * 1000 + i + 1),
          "account-id": 135, symbol: "btcusdt", type: "buy-limit", state: "submitted", amount: "1",
          "filled-amount": "0", price: "10", "created-at": created }));
      }
      return new Response(JSON.stringify({ ...(request.pathname.startsWith("/v2/") ? { code: 200 } : { status: "ok" }), data }));
    } });
  return { handle, calls: () => calls };
}
function run(f: Fixture, client = owner, abort = new AbortController(), settings: Parameters<typeof transport>[1] = {}, store = f.store) {
  const io = transport(f, settings);
  return { io, abort, result: acquireHtxAccountV1Postgres({ db: client.db, context: { organizationId }, accountId: f.job.accountId,
    acquisitionId: f.job.id, transport: io.handle, store, signal: abort.signal }) };
}
async function snapshot(f: Fixture, client = owner) {
  return readHtxAccountAcquisitionV1Postgres(client.db, { organizationId }, { accountId: f.job.accountId, acquisitionId: f.job.id });
}
async function holder(f: Fixture) {
  const ready = gate(), release = gate(); let tx!: postgres.TransactionSql;
  const done = controller.sql.begin(async connection => { tx = connection;
    await tx`SELECT id FROM trader_risk_account_acquisition_jobs_v1 WHERE organization_id=${organizationId}::uuid
      AND account_id=${f.job.accountId} AND id=${f.job.id}::uuid FOR UPDATE`; ready.release(); await release.promise;
  });
  await Promise.race([ready.promise, done.then(() => { throw new Error("HOLDER_CLOSED_BEFORE_ACQUIRED"); })]);
  return { tx, release: release.release, done };
}
async function observeWait(tx: postgres.TransactionSql, client: Client) {
  const until = performance.now() + 4000;
  while (performance.now() < until) {
    await tx`SELECT pg_stat_clear_snapshot()`;
    const rows = await tx`SELECT pid,query,state,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers
      FROM pg_stat_activity WHERE pid=${client.pid}`;
    const row = rows[0];
    if (row?.wait_event_type === "Lock" && String(row.query).includes("trader_risk_account_acquisition_jobs_v1") &&
        /for (share|update)/i.test(String(row.query)) && Array.isArray(row.blockers) && row.blockers.includes(controller.pid)) {
      receipt("actual-lock-wait", { ...row, expectedBlocker: controller.pid }); return;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("ACTUAL_JOB_WAIT_NOT_OBSERVED");
}

describe.skipIf(!enabled || !url)("Postgres DEE-1135 observation-only acquisition component", () => {
  beforeAll(async () => {
    const parsed = new URL(url!); expect(parsed.hostname).toBe("127.0.0.1"); expect(parsed.port).toBe("54329");
    owner = await connect("owner"); controller = await connect("controller"); actorId = randomUUID(); auditId = randomUUID(); sourceId = randomUUID();
    await owner.sql`INSERT INTO auth.users(id) VALUES(${actorId}::uuid)`;
    await owner.db.insert(schema.users).values({ id: actorId, identityLabel: "DEE1135 inactive synthetic fixture", email: `${actorId}@waia.invalid`, passwordHash: null });
    organizationId = await ensureUserCoreSeedPostgres(owner.db, { userId: actorId, displayName: "DEE1135 observation-only" });
    await owner.db.insert(schema.auditLogs).values({ id: auditId, actorType: "user", actorId, action: "DEE1135_INACTIVE_COMPONENT_FIXTURE",
      entityType: "test-fixture", entityId: sourceId, organizationId, metadataJson: { authority: "NONE", activation: false } });
    await owner.db.insert(schema.traderMiSource).values({ id: sourceId, organizationId, venue: "HTX", feedKind: "account_snapshot",
      description: "Synthetic component source; not qualified for account authority", status: "active" });
  }, 60000);
  afterAll(async () => {
    try {
      if (owner && organizationId) {
        const counts = (await owner.sql`SELECT
          (SELECT count(*)::int FROM trader_risk_account_current_v1 WHERE organization_id=${organizationId}::uuid) AS current,
          (SELECT count(*)::int FROM trader_risk_account_bases_v1 WHERE organization_id=${organizationId}::uuid) AS bases,
          (SELECT count(*)::int FROM trader_risk_allowances_v2 WHERE organization_id=${organizationId}::uuid) AS allowances,
          (SELECT count(*)::int FROM trader_orders WHERE organization_id=${organizationId}::uuid) AS orders`)[0];
        receipt("no-authority-effects", counts); expect(counts).toEqual({ current: 0, bases: 0, allowances: 0, orders: 0 });
      }
    } finally {
      const outcomes = await Promise.allSettled(clients.map(close)); master.fill(0);
      receipt("client-closure", { clients: clients.map(({ pid, name, closed, queries }) => ({ pid, name, closed, queryCount: queries.length })),
        outcomes: outcomes.map(x => x.status === "fulfilled" ? { status: x.status } : { status: x.status, reason: errorShape(x.reason) }),
        retainedSyntheticDirectories: directories });
      expect(outcomes.every(x => x.status === "fulfilled")).toBe(true);
    }
  }, 60000);

  it("retains real encrypted pages and exact raw lineage without creating dated account authority", async () => {
    const f = await fixture(), result = await run(f).result, saved = await snapshot(f);
    expect(result.kind).toBe("TERMINAL"); if (result.kind !== "TERMINAL") throw new Error("TERMINAL_REQUIRED");
    expect(result.payload).toMatchObject({ recordingStatus: "RECORDED", pages: 8, members: 5, coverage: "PARTIAL", stateValidTime: "UNKNOWN" });
    expect(saved.journal).toHaveLength(18);
    for (const entry of saved.journal) if (entry.kind === "PAGE") {
      const bytes = await f.store.read(entry.payload.binding, f.job.spec.maxRawBytes);
      const decoded = decodeHtxAccountAcquisitionPageV1({ spec: f.job.spec, lane: entry.payload.page.lane,
        cursor: entry.payload.page.requestCursor, bytes, acquiredAtUtc: entry.payload.page.acquiredAtUtc });
      expect(decoded).toEqual(entry.payload.page);
      expect(decoded.members.every(x => x.stateValidTime === "UNKNOWN")).toBe(true);
      const capture = (await owner.sql`SELECT content_digest FROM trader_mi_raw_capture_receipt_v1 WHERE id=${entry.payload.capture.contentDigest}`)[0];
      const validation = (await owner.sql`SELECT status,capture_receipt_digest FROM trader_mi_raw_validation_receipt_v1 WHERE id=${entry.payload.validation.contentDigest}`)[0];
      expect(capture?.content_digest).toBe(entry.payload.capture.contentDigest);
      expect(validation).toMatchObject({ status: "VALID", capture_receipt_digest: entry.payload.capture.contentDigest });
    }
    receipt("retained-pages", { job: f.job.id, terminal: result, entryDigests: saved.journal.map(x => x.contentDigest) });
  }, 90000);
  it("replays an immutable terminal from a fresh client without another transport or store effect", async () => {
    const f = await fixture(), initial = await run(f).result, priorPid = owner.pid;
    await close(owner); owner = await connect("replay-owner");
    let storeCalls = 0;
    const store: PrivateRawObjectStoreV1 = {
      put: async input => { storeCalls++; return f.store.put(input); },
      read: async (...input) => { storeCalls++; return f.store.read(...input); },
      inspectRetained: async (...input) => { storeCalls++; return f.store.inspectRetained(...input); },
    };
    const again = run(f, owner, new AbortController(), {}, store);
    expect(await again.result).toEqual(initial); expect(again.io.calls()).toBe(0); expect(storeCalls).toBe(0);
    expect((await snapshot(f)).journal).toHaveLength(18);
    receipt("terminal-replay", { job: f.job.id, original: initial.contentDigest, priorPid,
      priorClosed: clients.find(c => c.pid === priorPid)?.closed, pid: owner.pid, transportCalls: again.io.calls(), storeCalls });
  }, 90000);
  it("retains a real rejected chronology receipt and truthful partial terminal", async () => {
    const f = await fixture(), attempt = run(f, owner, new AbortController(), { invalid: true });
    await expect(attempt.result).rejects.toThrow("CONDITIONAL_CHRONOLOGY");
    const saved = await snapshot(f), terminal = saved.journal.at(-1)!;
    expect(terminal.kind).toBe("TERMINAL"); if (terminal.kind !== "TERMINAL") throw new Error("TERMINAL_REQUIRED");
    expect(terminal.payload).toMatchObject({ recordingStatus: "PARTIAL", reason: "CONDITIONAL_CHRONOLOGY", pages: 2, members: 4 });
    const rejected = await owner.sql`SELECT status,reason_codes_json FROM trader_mi_raw_validation_receipt_v1
      WHERE organization_id=${organizationId}::uuid AND status='REJECTED'`;
    expect(rejected.some(row => row.reason_codes_json === '["CONDITIONAL_CHRONOLOGY"]')).toBe(true);
    receipt("rejected-chronology", { job: f.job.id, terminal, rejected });
  }, 90000);
  it("gives exactly one real first owner to two clients after observed job-row waits", async () => {
    const f = await fixture(), peer = await connect("race"), held = await holder(f), response = gate(), reached = gate();
    const settings = { beforeResponse: async () => { reached.release(); await response.promise; } };
    const a = run(f, owner, new AbortController(), settings), b = run(f, peer, new AbortController(), settings);
    const settled = [a.result, b.result].map(p => p.then(value => ({ status: "fulfilled" as const, value }), reason => ({ status: "rejected" as const, reason })));
    try {
      await observeWait(held.tx, owner); await observeWait(held.tx, peer); held.release(); await held.done; await reached.promise;
      const loser = await Promise.race(settled); expect(loser.status).toBe("rejected"); response.release();
      const outcomes = await Promise.all(settled);
      receipt("first-owner-race", { job: f.job.id, pids: [owner.pid, peer.pid], outcomes: outcomes.map(x => x.status === "fulfilled" ?
        { status: x.status, digest: x.value.contentDigest } : { status: x.status, error: errorShape(x.reason) }), calls: [a.io.calls(), b.io.calls()] });
      expect(outcomes.filter(x => x.status === "fulfilled")).toHaveLength(1); expect([a.io.calls(), b.io.calls()].sort((x, y) => x - y)).toEqual([0, 8]);
      expect((await snapshot(f)).journal).toHaveLength(18);
    } finally { response.release(); held.release(); await held.done; await Promise.all(settled); await close(peer); }
  }, 90000);
  it("refuses caller cancellation after an actual held job wait before transport or START", async () => {
    const f = await fixture(), held = await holder(f), abort = new AbortController(), attempt = run(f, owner, abort);
    const settled = attempt.result.then(value => ({ value }), error => ({ error }));
    try { await observeWait(held.tx, owner); abort.abort(); held.release(); await held.done;
      const result = await settled; receipt("abort-during-wait", { job: f.job.id, result: "error" in result ? errorShape(result.error) : result });
      expect("error" in result && String(result.error).includes("ABORTED")).toBe(true); expect(attempt.io.calls()).toBe(0);
      expect((await snapshot(f)).journal).toHaveLength(0);
    } finally { held.release(); await held.done; await settled; }
  }, 30000);
  it("preserves actual nested PostgreSQL lock timeout separately from deadlock or harness failure", async () => {
    const f = await fixture(), held = await holder(f), started = performance.now(), attempt = run(f);
    const settled = attempt.result.then(value => ({ value }), error => ({ error }));
    try { await observeWait(held.tx, owner); const result = await settled;
      receipt("actual-lock-timeout", { job: f.job.id, elapsedMs: performance.now() - started, result: "error" in result ? errorShape(result.error) : result });
      expect("error" in result ? errorCodes(result.error) : []).toContain("55P03"); expect(attempt.io.calls()).toBe(0);
    } finally { held.release(); await held.done; await settled; }
    expect((await snapshot(f)).journal).toHaveLength(0);
  }, 30000);
  it("retains encrypted PREPARED evidence after abort at actual put settlement", async () => {
    const f = await fixture(), abort = new AbortController();
    const store: PrivateRawObjectStoreV1 = { ...f.store, put: async input => { const binding = await f.store.put(input); abort.abort(); return binding; } };
    await expect(run(f, owner, abort, {}, store).result).rejects.toThrow("ABORTED");
    const saved = await snapshot(f), objects = (await readdir(f.directory)).filter(name => /^[0-9a-f-]{36}$/.test(name));
    expect(saved.journal.map(x => x.kind)).toEqual(["START", "PREPARED"]); expect(objects).toHaveLength(1);
    const retained = await f.store.inspectRetained(objects[0]!, f.job.spec.maxRawBytes), prepared = saved.journal[1]!;
    if (prepared.kind !== "PREPARED") throw new Error("PREPARED_REQUIRED");
    expect(retained.binding.rawBytesDigest).toBe(prepared.payload.rawBytesDigest); expect(retained.retentionSeconds).toBe(f.job.spec.retentionSeconds);
    const retry = run(f); await expect(retry.result).rejects.toThrow("RETAINED_PREFIX_REQUIRES_RECOVERY"); expect(retry.io.calls()).toBe(0);
    receipt("retained-encrypted-prefix", { job: f.job.id, retained, entryDigests: saved.journal.map(x => x.contentDigest) });
  }, 90000);
  it("preserves committed capture when a test adapter loses its acknowledgement without claiming network ambiguity", async () => {
    const f = await fixture(), abort = new AbortController(); let lost = false;
    const adapted = new Proxy(owner.db, { get(target, key) {
      if (key !== "transaction") { const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; }
      return async (...args: Parameters<WaiaPostgresDb["transaction"]>) => {
        const result = await Reflect.apply(target.transaction, target, args);
        if (!lost && result && typeof result === "object" && "receipt" in result && result.receipt && typeof result.receipt === "object" &&
            "schemaVersion" in result.receipt && result.receipt.schemaVersion === "raw-capture-receipt-v1") { lost = true; abort.abort(); throw new Error("TEST_POST_COMMIT_ACK_LOSS"); }
        return result;
      };
    } });
    await expect(run(f, { ...owner, db: adapted }, abort).result).rejects.toThrow("TEST_POST_COMMIT_ACK_LOSS");
    const fresh = await connect("ack-loss-read");
    try { const saved = await snapshot(f, fresh); expect(saved.journal.map(x => x.kind)).toEqual(["START", "PREPARED"]);
      const prepared = saved.journal[1]!; if (prepared.kind !== "PREPARED") throw new Error("PREPARED_REQUIRED");
      const captures = await fresh.sql`SELECT id,storage_binding_digest FROM trader_mi_raw_capture_receipt_v1
        WHERE organization_id=${organizationId}::uuid AND raw_bytes_digest=${prepared.payload.rawBytesDigest}`;
      // Same source-shaped payload can recur in other fixtures; bind this object's immutable locator exactly.
      const objects = (await readdir(f.directory)).filter(name => /^[0-9a-f-]{36}$/.test(name)); expect(objects).toHaveLength(1);
      const retained = await f.store.inspectRetained(objects[0]!, f.job.spec.maxRawBytes);
      expect(captures.filter(row => row.storage_binding_digest === retained.binding.contentDigest)).toHaveLength(1);
      const retry = run(f, fresh); await expect(retry.result).rejects.toThrow("RETAINED_PREFIX_REQUIRES_RECOVERY"); expect(retry.io.calls()).toBe(0);
      receipt("post-commit-ack-loss", { mechanism: "TEST_ADAPTER_AFTER_ACTUAL_COMMIT", job: f.job.id, lost, retained, captures });
    } finally { await close(fresh); }
  }, 90000);
  it("refuses malformed and oversized retained bodies and actual cumulative read exhaustion", async () => {
    for (const padding of ["bad-shape", "x".repeat(1048576)]) {
      const f = await fixture(), body = { schemaVersion: "htx-account-acquisition/v1", organizationId, accountId: f.job.accountId,
        acquisitionId: f.job.id, jobDigest: f.job.contentDigest, sequence: 0, previousDigest: null, kind: "START", replayKey: "START",
        recordedAtUtc: new Date().toISOString(), payload: { padding } }, bodyText = canonicalJsonString(body);
      await owner.db.insert(schema.traderHtxAccountAcquisitionsV1).values({ organizationId, accountId: f.job.accountId,
        acquisitionId: f.job.id, sequence: 0, previousDigest: null, kind: "START", replayKey: "START", bodyText, contentDigest: hash(bodyText) });
      const start = owner.queries.length; await expect(snapshot(f)).rejects.toThrow();
      const queries = owner.queries.slice(start); receipt("body-admission-refusal", { job: f.job.id, bodyBytes: Buffer.byteLength(bodyText), queries });
      if (padding.length > 1000) {
        const journalQueries = queries.filter(q => q.includes('"trader_htx_account_acquisitions_v1"'));
        expect(journalQueries).toHaveLength(1); expect(journalQueries[0]).toContain("count(*)");
        expect(journalQueries[0]).toContain("octet_length");
      }
    }
    const f = await fixture({ pages: 96, pageSize: 100, members: 8192 }), attempt = run(f, owner, new AbortController(), { largePages: true });
    const result = await attempt.result.then(value => ({ value }), error => ({ error }));
    receipt("cumulative-read-budget", { job: f.job.id, calls: attempt.io.calls(), result: "error" in result ? errorShape(result.error) : result });
    expect("error" in result && String(result.error).includes("DATABASE_READ_BUDGET")).toBe(true);
    const saved = await snapshot(f); expect(saved.journal.at(-1)?.kind).not.toBe("TERMINAL"); expect(attempt.io.calls()).toBeLessThan(96);
  }, 330000);
  it("enforces real tenant, immutable, unique and digest constraints with every guard enabled", async () => {
    const f = await fixture(); await run(f).result;
    await expect(readHtxAccountAcquisitionV1Postgres(owner.db, { organizationId: randomUUID() }, { accountId: f.job.accountId, acquisitionId: f.job.id })).rejects.toThrow("JOB_MISSING");
    const attempts = [
      owner.sql`UPDATE trader_htx_account_acquisitions_v1 SET replay_key=replay_key WHERE organization_id=${organizationId}::uuid AND acquisition_id=${f.job.id}::uuid`,
      owner.sql`DELETE FROM trader_htx_account_acquisitions_v1 WHERE organization_id=${organizationId}::uuid AND acquisition_id=${f.job.id}::uuid`,
    ];
    const constraintOutcomes: unknown[] = [];
    for (const attempt of attempts) { const result = await attempt.then(() => null, error => error);
      constraintOutcomes.push(errorShape(result)); expect(errorCodes(result)).toContain("23514"); }
    const original = (await snapshot(f)).journal[0]!, { contentDigest, ...body } = original;
    const badInsert = async (digest: string) => owner.db.insert(schema.traderHtxAccountAcquisitionsV1).values({ organizationId,
      accountId: f.job.accountId, acquisitionId: f.job.id, sequence: 0, previousDigest: null, kind: "START", replayKey: "START",
      contentDigest: digest, bodyText: canonicalJsonString(body) });
    for (const [digest, expected] of [[contentDigest, "23505"], [hash("wrong-digest"), "23514"]]) {
      const error = await badInsert(digest!).then(() => null, e => e); constraintOutcomes.push(errorShape(error));
      expect(errorCodes(error)).toContain(expected);
    }
    for (const broken of [
      { ...body, acquisitionId: randomUUID() },
      { ...body, sequence: 18, previousDigest: hash("MISSING_PREDECESSOR"), replayKey: "BROKEN_PREDECESSOR" },
    ]) {
      const bodyText = canonicalJsonString(broken), error = await owner.db.insert(schema.traderHtxAccountAcquisitionsV1).values({
        organizationId, accountId: f.job.accountId, acquisitionId: broken.acquisitionId, sequence: broken.sequence,
        previousDigest: broken.previousDigest, replayKey: broken.replayKey, kind: broken.kind, bodyText, contentDigest: hash(bodyText),
      }).then(() => null, e => e);
      constraintOutcomes.push(errorShape(error)); expect(errorCodes(error)).toContain("23503");
    }
    for (const role of ["anon", "authenticated"]) for (const query of [
      "SELECT body_text FROM trader_htx_account_acquisitions_v1 LIMIT 1",
      "UPDATE trader_htx_account_acquisitions_v1 SET replay_key=replay_key WHERE false",
    ]) {
      const result = await controller.sql.begin(async tx => { await tx.unsafe(`SET LOCAL ROLE ${role}`);
        await tx.unsafe(query); }).then(() => null, e => e);
      constraintOutcomes.push(errorShape(result)); expect(errorCodes(result)).toContain("42501");
    }
    const guards = await owner.sql`SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid='trader_htx_account_acquisitions_v1'::regclass AND NOT tgisinternal`;
    expect(guards.every(row => row.tgenabled === "O")).toBe(true); receipt("isolation-and-guards", { job: f.job.id, guards, constraintOutcomes, rows: (await snapshot(f)).journal.length });
  }, 90000);
});
