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
import { and, eq, sql as sqlQuery } from "drizzle-orm";
import {
  bindExecutionAuthorityV2Postgres,
  dispatchCommittedExecutionAttemptV2,
  ExecutionV2AuthorityRefusedError,
  type BindExecutionAuthorityV2Input,
} from "@/lib/trader/execution/v2/authority-postgres";
import {
  createExecutionPolicyBindingV2,
  validateExecutionPolicyBindingV2,
} from "@/lib/trader/execution/v2/contracts";
import { listExecutionReportsV2Postgres } from "@/lib/trader/execution/v2/repository-postgres";
import { divideDecimal } from "@/lib/trader/risk/numeric";
import { publishMirroredLiveCapitalEnvelopeV2 } from "../helpers/live-capital-test-envelope";
import {
  admitRiskAllowanceV2Postgres,
  initializeRiskAccountStateV2Postgres as initializeRiskAccountStateRaw,
  RiskV2AdmissionRefusedError,
  type AdmitRiskAllowanceV2Input,
} from "@/lib/trader/risk/v2/risk-allowance-repository-postgres";
import { createRiskAccountProfileV1, createRiskAccountReferenceV1, riskAccountDigestV1,
  sealRiskAccountRecordV1, RISK_ACCOUNT_CHANNELS_V1, RISK_REFERENCE_METHOD_V1,
  type RiskReferenceMemberV1 } from "@/lib/trader/risk/v2/risk-account-source-profile-v1";

async function initializeRiskAccountStateV2Postgres(
  database: Parameters<typeof initializeRiskAccountStateRaw>[0],
  context: Parameters<typeof initializeRiskAccountStateRaw>[1],
  state: Parameters<typeof initializeRiskAccountStateRaw>[2],
) {
  await initializeRiskAccountStateRaw(database, context, state);
  await publishMirroredLiveCapitalEnvelopeV2({
    organizationId: context.organizationId,
    accountId: state.accountId,
    exposureLimitNotional: state.accounting.exposureLimitNotional,
  });
}

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

// ---------------------------------------------------------------------------
// C01 — allowance-expiry / lock-wait baseline (separate org; ordinary paper).
// Hypothesis schedules observe production owners; no activated 1135 basis.
// ---------------------------------------------------------------------------
const c01Receipt = (stage: string, body: unknown) =>
  console.log(
    JSON.stringify({ kind: "DEE1135_C01_RECEIPT", stage, body }, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v instanceof Error ? errorShape(v) : v,
    ),
  );
const c01Hex = (seed: string) => createHash("sha256").update(seed).digest("hex");
type C01LockTx = Parameters<Parameters<WaiaPostgresDb["transaction"]>[0]>[0];
type C01LockTrace = Record<string, unknown>[];
type C01CompletedSelect = {
  toSQL(): { sql: string; params: unknown[] };
  execute(...args: unknown[]): Promise<unknown>;
};
type C01ProofState = {
  account: { r: string; p: string; next: string; head: string | null } | null;
  allowance: Record<string, unknown>[];
  events: { type: string; sequence: string; previous: string | null; digest: string }[];
  reports: { type: string; sequence: string; previous: string | null; digest: string }[];
  counts: Record<string, number>;
};

function c01NativeCauses(error: unknown): Record<string, unknown>[] {
  const causes: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    const cause = error as Error & {
      code?: string;
      detail?: string;
      reason?: string;
      cause?: unknown;
    };
    causes.push({
      name: cause.name,
      message: cause.message,
      code: cause.code,
      detail: cause.detail,
      reason: cause.reason,
    });
    error = cause.cause;
  }
  if (error && typeof error !== "object") causes.push({ value: String(error) });
  return causes;
}
function c01Settled<T>(operation: Promise<T>) {
  return operation.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error, causes: c01NativeCauses(error) }),
  );
}

describe.skipIf(!enabled || !url)("Postgres DEE-1135 C01 allowance-expiry baseline", () => {
  const c01Clients: { client: postgres.Sql; label: string; pid: number }[] = [];
  let c01Sql: postgres.Sql;
  let c01Db: WaiaPostgresDb;
  let c01Org: string;
  let c01ActorId: string;

  function c01Account(accountId: string) {
    return {
      accountId,
      posture: "NORMAL" as const,
      killState: "CLEAR" as const,
      reconciliationStatus: "RECONCILED" as const,
      realitySnapshotId: `reality-${accountId}`,
      realityContentDigestHex: c01Hex(`reality-${accountId}`),
      reconciliationAuthorityDigestHex: c01Hex(`reconciliation-${accountId}`),
      reconciledInstrumentExposures: [
        {
          instrumentIdentityDigestHex: c01Hex("BTCUSDT-SPOT"),
          symbol: "BTCUSDT",
          baseQuantity: "0",
        },
      ],
      accounting: {
        reconciledExposureNotional: "0",
        worstCasePendingExposureNotional: "0",
        outstandingReservationNotional: "0",
        exposureLimitNotional: "100",
      },
    };
  }

  function c01Admission(accountId: string): AdmitRiskAllowanceV2Input {
    return {
      accountId,
      riskVerdictId: randomUUID(),
      riskAllowanceId: randomUUID(),
      issuanceEventId: randomUUID(),
      nonce: randomUUID(),
      validForMs: 30_000,
      verdict: {
        venue: "HTX",
        market: "SPOT",
        symbol: "BTCUSDT",
        baseAsset: "BTC",
        quoteAsset: "USDT",
        instrumentIdentityDigestHex: c01Hex("BTCUSDT-SPOT"),
        decision: {
          decisionId: `decision-c01-paper-${accountId}`,
          semanticDigestHex: c01Hex(`decision-semantic-c01-${accountId}`),
          contentDigestHex: c01Hex(`decision-content-c01-${accountId}`),
          action: "ENTER_LONG",
          economicSizeSetId: `decision-c01-sizes-${accountId}`,
          economicSizeSetDigestHex: c01Hex(`decision-c01-sizes-${accountId}`),
          forecastId: `forecast-c01-${accountId}`,
          forecastContentDigestHex: c01Hex(`forecast-c01-${accountId}`),
          canonicalCausalLineageDigestHex: c01Hex(`causal-lineage-c01-${accountId}`),
        },
        riskPolicyVersion: "risk-v2-c01",
        riskPolicyDigestHex: c01Hex(`risk-v2-c01-${accountId}`),
        limitVersions: [{ layer: "L2", version: "position-v1", digestHex: c01Hex("position-v1") }],
        reality: {
          snapshotId: `reality-${accountId}`,
          contentDigestHex: c01Hex(`reality-${accountId}`),
          asOfUtc: "2026-08-21T00:00:00.000Z",
          reconciliationAuthorityDigestHex: c01Hex(`reconciliation-${accountId}`),
          reconciliationStatus: "RECONCILED",
        },
        referencePrice: {
          authorityId: "test-median",
          authorityVersion: "v1",
          contentDigestHex: c01Hex("test-median-v1"),
          price: divideDecimal("25", "0.001"),
        },
        verdict: "APPROVE_CLAMPED",
        approvedQualifiedQuantity: "0.001",
        bindingLayers: ["L2"],
        reasonCodes: ["POSITION_LIMIT_BINDING"],
      },
    };
  }

  async function c01AdmittedBindInput(
    options: { validForMs?: number } = {},
  ): Promise<BindExecutionAuthorityV2Input> {
    const accountId = `c01-${randomUUID()}`;
    await initializeRiskAccountStateV2Postgres(
      c01Db,
      { organizationId: c01Org },
      c01Account(accountId),
    );
    const request = c01Admission(accountId);
    const admitted = await admitRiskAllowanceV2Postgres(
      c01Db,
      { organizationId: c01Org },
      {
        ...request,
        validForMs: options.validForMs ?? request.validForMs,
      },
    );
    const allowance = admitted.allowance;
    const now = Date.now();
    const opensAtUtc = new Date(now - 60_000).toISOString();
    const closesAtUtc = new Date(now + 120_000).toISOString();
    const policy = createExecutionPolicyBindingV2({
      executionPolicyId: randomUUID(),
      organizationId: c01Org,
      policyVersion: `htx-c01-paper-v1-${accountId}`,
      decisionId: allowance.decision.decisionId,
      decisionContentDigestHex: allowance.decision.contentDigestHex,
      decisionExecutionPolicyDigestHex: c01Hex(`c01-decision-execution-policy-${accountId}`),
      economicSizeSetDigestHex: allowance.decision.economicSizeSetDigestHex,
      venue: "HTX",
      market: "SPOT",
      instrumentIdentityDigestHex: allowance.instrumentIdentityDigestHex,
      allowedOrderTypes: ["limit"],
      allowedTimeInForce: ["GTC"],
      allowedLiquidityRoles: ["MAKER"],
      priceCollar: {
        minimumPrice: "24000",
        maximumPrice: "26000",
        authorityDigestHex: c01Hex(`c01-collar-${accountId}`),
      },
      quantityRules: {
        minimumQuantity: "0.001",
        quantityStep: "0.001",
        roundingMode: "EXACT",
        economicQualifiedQuantities: ["0.001"],
      },
      slicingPolicy: { maximumSlices: 1, completePlanRequired: true },
      retryPolicy: {
        maximumNetworkSubmissions: 1,
        sameIdentityRetryAllowed: false,
        venueIdempotencyProven: false,
      },
      cancelPolicy: {
        protectiveCancelAllowed: true,
        replacementRequiresPresealedOrFreshAuthority: true,
      },
      timeoutMs: 5_000,
      uncertaintyHandling: "RECONCILIATION_REQUIRED",
      effectiveFromUtc: new Date(now - 120_000).toISOString(),
      effectiveUntilUtc: new Date(now + 120_000).toISOString(),
    });
    return {
      allowance,
      policy,
      plan: {
        approvedNotionalCeiling: "25",
        plannedQuantity: "0.001",
        orderType: "limit",
        liquidityRole: "MAKER",
        limitPrice: "25000",
        timeInForce: "GTC",
        timingWindow: { opensAtUtc, closesAtUtc },
        childSlices: [{ sequence: 1, quantity: "0.001", limitPrice: "25000" }],
        sealedAtUtc: opensAtUtc,
      },
      executionMode: "paper",
      credentialId: null,
      strategySignalId: `signal-c01-${accountId}`,
      allocationDecisionId: `allocation-c01-${accountId}`,
    };
  }

  async function c01LockProofState(input: BindExecutionAuthorityV2Input): Promise<C01ProofState> {
    const accountId = input.allowance.accountId;
    const [state] = await c01Sql<
      {
        r: string;
        p: string;
        next: string;
        head: string | null;
      }[]
    >`SELECT outstanding_reservation_notional::text AS r,
      worst_case_pending_exposure_notional::text AS p,
      next_enforcement_event_sequence::text AS next, last_enforcement_event_digest AS head
      FROM trader_risk_account_state_v2
      WHERE organization_id = ${c01Org}::uuid AND account_id = ${accountId}`;
    const allowance = await c01Sql`SELECT lifecycle_state, bound_order_id, bound_order_digest,
      last_enforcement_event_sequence::text, last_enforcement_event_digest, content_digest,
      expired_at, revoked_at
      FROM trader_risk_allowances_v2
      WHERE organization_id = ${c01Org}::uuid AND id = ${input.allowance.riskAllowanceId}::uuid`;
    const events = await c01Sql<
      {
        type: string;
        sequence: string;
        previous: string | null;
        digest: string;
      }[]
    >`SELECT event_type AS type, event_sequence::text AS sequence,
      previous_event_digest AS previous, content_digest AS digest
      FROM trader_risk_enforcement_events_v2
      WHERE organization_id = ${c01Org}::uuid AND account_id = ${accountId}
      ORDER BY event_sequence LIMIT 8`;
    const reports = await c01Sql<
      {
        type: string;
        sequence: string;
        previous: string | null;
        digest: string;
      }[]
    >`SELECT report_type AS type, report_sequence::text AS sequence,
      previous_report_digest AS previous, content_digest AS digest
      FROM trader_execution_reports_v2
      WHERE organization_id = ${c01Org}::uuid AND account_id = ${accountId}
      ORDER BY report_sequence LIMIT 8`;
    const [counts] = await c01Sql`SELECT
      (SELECT count(*)::int FROM trader_execution_policies_v2 p
        WHERE p.organization_id = ${c01Org}::uuid
          AND EXISTS (
            SELECT 1 FROM trader_execution_plans_v2 pl
            WHERE pl.organization_id = p.organization_id AND pl.execution_policy_id = p.id
              AND pl.account_id = ${accountId})) AS policies,
      (SELECT count(*)::int FROM trader_execution_plans_v2
        WHERE organization_id = ${c01Org}::uuid AND account_id = ${accountId}) AS plans,
      (SELECT count(*)::int FROM trader_orders o
        WHERE o.organization_id = ${c01Org}::uuid
          AND o.risk_allowance_id = ${input.allowance.riskAllowanceId}::uuid) AS orders,
      (SELECT count(*)::int FROM trader_execution_attempts_v2
        WHERE organization_id = ${c01Org}::uuid AND account_id = ${accountId}) AS attempts,
      (SELECT count(*)::int FROM trader_execution_reports_v2
        WHERE organization_id = ${c01Org}::uuid AND account_id = ${accountId}) AS reports,
      (SELECT count(*)::int FROM trader_risk_enforcement_events_v2
        WHERE organization_id = ${c01Org}::uuid AND account_id = ${accountId}) AS events`;
    return {
      account: state ?? null,
      allowance,
      events,
      reports,
      counts: counts as Record<string, number>,
    };
  }

  function c01LockClient(
    label: string,
    trace: C01LockTrace,
    pause?: { resource: "account" | "attempt"; identity: string },
  ) {
    const client = postgres(url!, {
      max: 1,
      connect_timeout: 5,
      connection: { application_name: `dee1135-c01-${label}` },
    });
    const plainDb = drizzle(client, { schema }) as WaiaPostgresDb;
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const actor = {
      client,
      plainDb,
      db: plainDb,
      label,
      pid: 0,
      tx: null as C01LockTx | null,
      paused: false,
      release,
    };
    c01Clients.push(actor);
    actor.db = new Proxy(plainDb, {
      get(target, property) {
        if (property !== "transaction") {
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (
          run: (tx: C01LockTx) => Promise<unknown>,
          config?: Parameters<WaiaPostgresDb["transaction"]>[1],
        ) => {
          try {
            const result = await target.transaction(async (tx) => {
              actor.tx = tx;
              await tx.execute(sqlQuery`SET LOCAL lock_timeout = '10s'`);
              await tx.execute(sqlQuery`SET LOCAL statement_timeout = '15s'`);
              await tx.execute(sqlQuery`SET LOCAL idle_in_transaction_session_timeout = '20s'`);
              const [identity] = await tx.execute<{
                pid: number;
                at: Date;
                deadlock_before_timeout: boolean;
              }>(
                sqlQuery`SELECT pg_backend_pid() AS pid, clock_timestamp() AS at,
                  current_setting('deadlock_timeout')::interval < interval '10 seconds'
                    AS deadlock_before_timeout`,
              );
              actor.pid = identity!.pid;
              trace.push({ actor: label, kind: "transaction-start", ...identity });
              expect(identity!.deadlock_before_timeout).toBe(true);
              const observed = new Proxy(tx, {
                get(realTx, key) {
                  if (key === "select")
                    return (...args: unknown[]) => {
                      const builder = Reflect.apply(realTx.select, realTx, args) as ReturnType<
                        C01LockTx["select"]
                      >;
                      const from = builder.from.bind(builder);
                      builder.from = ((...fromArgs: unknown[]) => {
                        const query = Reflect.apply(from, builder, fromArgs) as C01CompletedSelect;
                        const execute = query.execute.bind(query);
                        query.execute = async (...executeArgs: unknown[]) => {
                          const statement = query.toSQL();
                          const rows = await execute(...executeArgs);
                          const resource = (
                            [
                              ["account", "trader_risk_account_state_v2"],
                              ["attempt", "trader_execution_attempts_v2"],
                            ] as const
                          ).find(([, table]) => statement.sql.includes(`"${table}"`))?.[0];
                          if (resource && /\bfor update\b/i.test(statement.sql)) {
                            const [wall] = await realTx.execute<{ at: Date }>(
                              sqlQuery`SELECT clock_timestamp() AS at`,
                            );
                            trace.push({
                              actor: label,
                              kind: "lock-acquired",
                              resource,
                              at: wall!.at,
                              sql: statement.sql,
                              params: statement.params,
                              rowCount: Array.isArray(rows) ? rows.length : null,
                            });
                            if (!actor.paused && resource === pause?.resource) {
                              expect(statement.params).toContain(c01Org);
                              expect(statement.params).toContain(pause.identity);
                              expect(rows).toHaveLength(1);
                              actor.paused = true;
                              await released;
                            }
                          }
                          return rows;
                        };
                        return query;
                      }) as typeof builder.from;
                      return builder;
                    };
                  if (key === "execute")
                    return async (...args: Parameters<C01LockTx["execute"]>) => {
                      const rows = await realTx.execute(...args);
                      const first = (rows as unknown as { durable_at?: Date | string }[])[0];
                      if (first?.durable_at) {
                        trace.push({
                          actor: label,
                          kind: "clock",
                          at: new Date(first.durable_at).toISOString(),
                        });
                      }
                      return rows;
                    };
                  const value = Reflect.get(realTx, key);
                  return typeof value === "function" ? value.bind(realTx) : value;
                },
              });
              return run(observed);
            }, config);
            const [settledAt] = await plainDb.execute<{ at: Date }>(
              sqlQuery`SELECT clock_timestamp() AS at`,
            );
            trace.push({ actor: label, kind: "committed", at: settledAt!.at });
            return result;
          } catch (error) {
            trace.push({ actor: label, kind: "rolled-back", causes: c01NativeCauses(error) });
            throw error;
          } finally {
            actor.tx = null;
          }
        };
      },
    });
    return actor;
  }

  async function c01ObserveAccountWait(
    holder: ReturnType<typeof c01LockClient>,
    binder: ReturnType<typeof c01LockClient>,
    trace: C01LockTrace,
  ) {
    await expect.poll(() => binder.pid, { timeout: 5_000 }).not.toBe(0);
    expect(binder.pid).not.toBe(holder.pid);
    await expect
      .poll(
        async () => {
          await holder.tx!.execute(sqlQuery`SELECT pg_stat_clear_snapshot()`);
          const rows = await holder.tx!.execute<{
            pid: number;
            query: string;
            blockers: number[];
            wait_event: string | null;
          }>(
            sqlQuery`SELECT pid, query, wait_event, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
          WHERE pid = ${binder.pid} AND wait_event_type = 'Lock'
            AND ${holder.pid} = ANY(pg_blocking_pids(pid))`,
          );
          const waiting = rows[0];
          if (
            !waiting?.query.includes("trader_risk_account_state_v2") ||
            !/\bfor update\b/i.test(waiting.query)
          ) {
            return false;
          }
          const [wall] = await holder.tx!.execute<{ at: Date }>(
            sqlQuery`SELECT clock_timestamp() AS at`,
          );
          trace.push({
            kind: "observed-server-wait",
            resource: "account",
            holderPid: holder.pid,
            binderPid: binder.pid,
            waiting,
            at: wall!.at,
          });
          return true;
        },
        { timeout: 5_000 },
      )
      .toBe(true);
  }

  async function c01WaitPastDeadline(
    holder: ReturnType<typeof c01LockClient>,
    deadline: string,
    trace: C01LockTrace,
  ) {
    const [before] = await holder.tx!.execute<{ at: Date }>(
      sqlQuery`SELECT clock_timestamp() AS at`,
    );
    trace.push({ kind: "before-deadline", at: before!.at, deadline });
    expect(new Date(before!.at).getTime()).toBeLessThan(new Date(deadline).getTime());
    await expect
      .poll(
        async () => {
          const [row] = await holder.tx!.execute<{ at: Date }>(
            sqlQuery`SELECT clock_timestamp() AS at`,
          );
          if (new Date(row!.at).getTime() < new Date(deadline).getTime()) return false;
          trace.push({ kind: "deadline-reached", at: row!.at, deadline });
          return true;
        },
        { timeout: 8_000 },
      )
      .toBe(true);
  }

  async function c01FinishProof(
    test: string,
    input: BindExecutionAuthorityV2Input,
    trace: C01LockTrace,
    actors: ReturnType<typeof c01LockClient>[],
    operations: Promise<unknown>[],
  ) {
    actors.forEach((actor) => actor.release());
    const outcomes = await Promise.all(operations);
    const [postSettlement] = await c01Sql<{ at: Date }[]>`SELECT clock_timestamp() AS at`;
    trace.push({ kind: "post-settlement", at: postSettlement!.at });
    c01Receipt(test, { phase: "settled", trace, outcomes });
    try {
      const state = await c01LockProofState(input);
      c01Receipt(test, { phase: "durable-state", state });
      return { outcomes, state, postSettlement: postSettlement!.at };
    } finally {
      const closed = await Promise.allSettled(
        actors.map((actor) => actor.client.end({ timeout: 5 })),
      );
      c01Receipt(test, { phase: "closed", closed: closed.map((x) => x.status) });
      expect(closed.every((result) => result.status === "fulfilled")).toBe(true);
    }
  }

  beforeAll(async () => {
    const parsed = new URL(url!);
    expect(parsed.hostname).toBe("127.0.0.1");
    expect(parsed.port).toBe("54329");
    c01Sql = postgres(url!, {
      max: 4,
      prepare: false,
      connect_timeout: 10,
      connection: {
        application_name: "dee1135-c01-owner",
        statement_timeout: 30000,
        lock_timeout: 10000,
      },
    });
    c01Db = drizzle(c01Sql, { schema }) as WaiaPostgresDb;
    const [identity] = await c01Sql`SELECT pg_backend_pid() AS pid, current_database() AS database,
      current_user AS role, current_setting('server_version_num') AS version,
      current_setting('session_replication_role') AS replication_role`;
    expect(identity).toMatchObject({
      role: "waia_validate",
      version: "160014",
      replication_role: "origin",
    });
    expect(String(identity!.database)).toMatch(/^waia_dee1121_dee1135_acquisition_[a-z0-9_]+$/);
    c01ActorId = randomUUID();
    await c01Sql`INSERT INTO auth.users(id) VALUES(${c01ActorId}::uuid)`;
    await c01Db.insert(schema.users).values({
      id: c01ActorId,
      identityLabel: "DEE1135 C01 paper fixture",
      email: `${c01ActorId}@waia.invalid`,
      passwordHash: null,
    });
    c01Org = await ensureUserCoreSeedPostgres(c01Db, {
      userId: c01ActorId,
      displayName: "DEE1135 C01 paper",
    });
    c01Receipt("c01-org", {
      organizationId: c01Org,
      actorId: c01ActorId,
      pid: identity!.pid,
      note: "separate from acquisition org; ordinary paper Risk/Execution only",
    });
  }, 60_000);

  afterAll(async () => {
    const outcomes = await Promise.allSettled([
      ...c01Clients.map((c) => c.client.end({ timeout: 5 })),
      c01Sql ? c01Sql.end({ timeout: 5 }) : Promise.resolve(),
    ]);
    c01Receipt("c01-client-closure", {
      outcomes: outcomes.map((x) =>
        x.status === "fulfilled"
          ? { status: x.status }
          : { status: x.status, reason: errorShape(x.reason) },
      ),
    });
    expect(outcomes.every((x) => x.status === "fulfilled")).toBe(true);
  }, 60_000);

  it("C01 initial bind across allowance-only expiry", async () => {
    const input = await c01AdmittedBindInput({ validForMs: 3_000 });
    const allowanceDeadline = input.allowance.validUntilUtc;
    const before = await c01LockProofState(input);
    const trace: C01LockTrace = [{ kind: "before", state: before, allowanceDeadline }];
    const holder = c01LockClient("allowance-expiry-holder", trace, {
      resource: "account",
      identity: input.allowance.accountId,
    });
    const binder = c01LockClient("allowance-expiry-bind", trace);
    const operations: Promise<unknown>[] = [];
    let proof!: Awaited<ReturnType<typeof c01FinishProof>>;
    try {
      operations.push(
        c01Settled(
          holder.db.transaction(async (tx) => {
            await tx
              .select()
              .from(schema.traderRiskAccountStateV2)
              .where(
                and(
                  eq(schema.traderRiskAccountStateV2.organizationId, c01Org),
                  eq(schema.traderRiskAccountStateV2.accountId, input.allowance.accountId),
                ),
              )
              .for("update");
          }),
        ),
      );
      await expect.poll(() => holder.paused, { timeout: 5_000 }).toBe(true);
      const [preBind] = await holder.tx!.execute<{ at: Date }>(
        sqlQuery`SELECT clock_timestamp() AS at`,
      );
      expect(new Date(preBind!.at).getTime()).toBeLessThan(new Date(allowanceDeadline).getTime());
      operations.push(
        c01Settled(bindExecutionAuthorityV2Postgres(binder.db, { organizationId: c01Org }, input)),
      );
      await c01ObserveAccountWait(holder, binder, trace);
      const binderStart = trace.find(
        (e) => e.actor === binder.label && e.kind === "transaction-start",
      );
      expect(binderStart).toBeTruthy();
      expect(new Date(String((binderStart as { at: Date }).at)).getTime()).toBeLessThan(
        new Date(allowanceDeadline).getTime(),
      );
      await c01WaitPastDeadline(holder, allowanceDeadline, trace);
    } catch (error) {
      trace.push({ kind: "harness-failure", causes: c01NativeCauses(error) });
      throw error;
    } finally {
      proof = await c01FinishProof(
        "initial-bind/allowance-only-expiry",
        input,
        trace,
        [binder, holder],
        operations,
      );
    }
    // Late-bind hypothesis: production rechecks allowance under lock after the wait.
    c01Receipt("initial-bind-classification", {
      outcomes: proof.outcomes,
      before,
      after: proof.state,
      hypothesis: "initial-bind-across-allowance-only-expiry",
    });
    expect(proof.outcomes).toMatchObject([
      { ok: true },
      {
        ok: false,
        causes: expect.arrayContaining([expect.objectContaining({ reason: "ALLOWANCE_EXPIRED" })]),
      },
    ]);
    expect(proof.state).toEqual(before);
    expect(proof.state.allowance[0]).toMatchObject({ lifecycle_state: "ISSUED" });
    expect(proof.state.counts).toMatchObject({ orders: 0, attempts: 0, reports: 0, events: 1 });
  }, 30_000);

  it("C01 exact unsubmitted replay across allowance-only expiry", async () => {
    const input = await c01AdmittedBindInput({ validForMs: 3_000 });
    const original = await bindExecutionAuthorityV2Postgres(
      c01Db,
      { organizationId: c01Org },
      input,
    );
    expect(original.consumedNow).toBe(true);
    const before = await c01LockProofState(input);
    expect(before.allowance[0]).toMatchObject({ lifecycle_state: "CONSUMED" });
    expect(before.counts.orders).toBe(1);
    const allowanceDeadline = input.allowance.validUntilUtc;
    const trace: C01LockTrace = [
      {
        kind: "before",
        state: before,
        allowanceDeadline,
        originalAttempt: original.attempt.executionAttemptId,
      },
    ];
    const holder = c01LockClient("replay-expiry-holder", trace, {
      resource: "account",
      identity: input.allowance.accountId,
    });
    const binder = c01LockClient("replay-expiry-bind", trace);
    const operations: Promise<unknown>[] = [];
    let proof!: Awaited<ReturnType<typeof c01FinishProof>>;
    try {
      operations.push(
        c01Settled(
          holder.db.transaction(async (tx) => {
            await tx
              .select()
              .from(schema.traderRiskAccountStateV2)
              .where(
                and(
                  eq(schema.traderRiskAccountStateV2.organizationId, c01Org),
                  eq(schema.traderRiskAccountStateV2.accountId, input.allowance.accountId),
                ),
              )
              .for("update");
          }),
        ),
      );
      await expect.poll(() => holder.paused, { timeout: 5_000 }).toBe(true);
      const [preReplay] = await holder.tx!.execute<{ at: Date }>(
        sqlQuery`SELECT clock_timestamp() AS at`,
      );
      expect(new Date(preReplay!.at).getTime()).toBeLessThan(new Date(allowanceDeadline).getTime());
      operations.push(
        c01Settled(bindExecutionAuthorityV2Postgres(binder.db, { organizationId: c01Org }, input)),
      );
      await c01ObserveAccountWait(holder, binder, trace);
      await c01WaitPastDeadline(holder, allowanceDeadline, trace);
    } catch (error) {
      trace.push({ kind: "harness-failure", causes: c01NativeCauses(error) });
      throw error;
    } finally {
      proof = await c01FinishProof(
        "unsubmitted-replay/allowance-only-expiry",
        input,
        trace,
        [binder, holder],
        operations,
      );
    }
    c01Receipt("replay-classification", {
      outcomes: proof.outcomes,
      before,
      after: proof.state,
      hypothesis: "exact-unsubmitted-replay-across-allowance-only-expiry",
    });
    expect(proof.outcomes[0]).toMatchObject({ ok: true });
    expect(proof.outcomes[1]).toMatchObject({
      ok: false,
      error: expect.any(RiskV2AdmissionRefusedError),
      causes: expect.arrayContaining([expect.objectContaining({ reason: "ALLOWANCE_EXPIRED" })]),
    });
    expect(proof.state.counts.orders).toBe(1);
    expect(proof.state.counts.attempts).toBe(1);
    expect(proof.state.events.filter((e) => e.type === "ALLOWANCE_CONSUMED")).toHaveLength(1);
    expect(proof.state.account).toEqual(before.account);
    expect(proof.state.allowance).toEqual(before.allowance);
  }, 30_000);

  it("C01 still-current lock-wait with one inert dispatch", async () => {
    const input = await c01AdmittedBindInput({ validForMs: 60_000 });
    const original = await bindExecutionAuthorityV2Postgres(
      c01Db,
      { organizationId: c01Org },
      input,
    );
    const before = await c01LockProofState(input);
    const trace: C01LockTrace = [{ kind: "before", state: before }];
    const dispatcher = c01LockClient("still-current-dispatch", trace, {
      resource: "account",
      identity: input.allowance.accountId,
    });
    const binder = c01LockClient("still-current-replay", trace);
    const operations: Promise<unknown>[] = [];
    let callbacks = 0;
    let proof!: Awaited<ReturnType<typeof c01FinishProof>>;
    try {
      operations.push(
        c01Settled(
          dispatchCommittedExecutionAttemptV2(
            dispatcher.db,
            { organizationId: c01Org },
            original.attempt.executionAttemptId,
            async () => {
              callbacks += 1;
              trace.push({ kind: "inert-callback", callbacks });
              const reports = await listExecutionReportsV2Postgres(
                dispatcher.plainDb,
                { organizationId: c01Org },
                original.attempt.executionAttemptId,
              );
              expect(
                reports.filter((report) => report.reportType === "SUBMIT_STARTED"),
              ).toHaveLength(1);
              await dispatcher.plainDb.transaction(async (tx) => {
                await tx.execute(sqlQuery`SET LOCAL lock_timeout = '2s'`);
                await tx.execute(sqlQuery`SET LOCAL statement_timeout = '5s'`);
                await tx
                  .select()
                  .from(schema.traderRiskAccountStateV2)
                  .where(
                    and(
                      eq(schema.traderRiskAccountStateV2.organizationId, c01Org),
                      eq(schema.traderRiskAccountStateV2.accountId, input.allowance.accountId),
                    ),
                  )
                  .for("update");
              });
              trace.push({ kind: "callback-commit-and-lock-release-observed" });
              return { synthetic: true };
            },
          ),
        ),
      );
      await expect.poll(() => dispatcher.paused, { timeout: 5_000 }).toBe(true);
      operations.push(
        c01Settled(bindExecutionAuthorityV2Postgres(binder.db, { organizationId: c01Org }, input)),
      );
      await c01ObserveAccountWait(dispatcher, binder, trace);
    } catch (error) {
      trace.push({ kind: "harness-failure", causes: c01NativeCauses(error) });
      throw error;
    } finally {
      proof = await c01FinishProof(
        "still-current/inert-dispatch",
        input,
        trace,
        [binder, dispatcher],
        operations,
      );
    }
    expect(proof.outcomes).toMatchObject([
      { ok: true, value: { status: "SUBMITTED" } },
      {
        ok: true,
        value: {
          consumedNow: false,
          plan: original.plan,
          attempt: original.attempt,
          order: original.order,
        },
      },
    ]);
    expect(callbacks).toBe(1);
    const repeat = await c01Settled(
      dispatchCommittedExecutionAttemptV2(
        c01Db,
        { organizationId: c01Org },
        original.attempt.executionAttemptId,
        async () => {
          callbacks += 1;
          return { forbiddenResend: true };
        },
      ),
    );
    c01Receipt("repeat-dispatch", { repeat, callbacks });
    expect(repeat).toMatchObject({ ok: true, value: { status: "REFUSED_ALREADY_STARTED" } });
    expect(callbacks).toBe(1);
    expect(proof.state.counts.orders).toBe(1);
    expect(proof.state.events.filter((e) => e.type === "ALLOWANCE_CONSUMED")).toHaveLength(1);
  }, 30_000);

  it("C01 allowance expired before transaction entry", async () => {
    const input = await c01AdmittedBindInput({ validForMs: 2_000 });
    const allowanceDeadline = input.allowance.validUntilUtc;
    const before = await c01LockProofState(input);
    const trace: C01LockTrace = [{ kind: "before", state: before, allowanceDeadline }];
    const holder = c01LockClient("expired-before-entry-holder", trace, {
      resource: "account",
      identity: input.allowance.accountId,
    });
    const binder = c01LockClient("expired-before-entry-bind", trace);
    const operations: Promise<unknown>[] = [];
    let proof!: Awaited<ReturnType<typeof c01FinishProof>>;
    try {
      operations.push(
        c01Settled(
          holder.db.transaction(async (tx) => {
            await tx
              .select()
              .from(schema.traderRiskAccountStateV2)
              .where(
                and(
                  eq(schema.traderRiskAccountStateV2.organizationId, c01Org),
                  eq(schema.traderRiskAccountStateV2.accountId, input.allowance.accountId),
                ),
              )
              .for("update");
          }),
        ),
      );
      await expect.poll(() => holder.paused, { timeout: 5_000 }).toBe(true);
      await c01WaitPastDeadline(holder, allowanceDeadline, trace);
      operations.push(
        c01Settled(bindExecutionAuthorityV2Postgres(binder.db, { organizationId: c01Org }, input)),
      );
      await c01ObserveAccountWait(holder, binder, trace);
      const binderStart = trace.find(
        (e) => e.actor === binder.label && e.kind === "transaction-start",
      );
      expect(binderStart).toBeTruthy();
      expect(new Date(String((binderStart as { at: Date }).at)).getTime()).toBeGreaterThanOrEqual(
        new Date(allowanceDeadline).getTime(),
      );
    } catch (error) {
      trace.push({ kind: "harness-failure", causes: c01NativeCauses(error) });
      throw error;
    } finally {
      proof = await c01FinishProof(
        "expired-before-entry",
        input,
        trace,
        [binder, holder],
        operations,
      );
    }
    c01Receipt("expired-before-entry-classification", {
      outcomes: proof.outcomes,
      before,
      after: proof.state,
      note: "binder refusal must roll back Risk tentative expiry/release inside the outer transaction",
    });
    expect(proof.outcomes).toMatchObject([
      { ok: true },
      {
        ok: false,
        causes: expect.arrayContaining([expect.objectContaining({ reason: "ALLOWANCE_EXPIRED" })]),
      },
    ]);
    // Standalone Risk consume would commit EXPIRED; binder outer rollback keeps ISSUED.
    expect(proof.state).toEqual(before);
    expect(proof.state.allowance[0]).toMatchObject({ lifecycle_state: "ISSUED", expired_at: null });
    expect(proof.state.events.map((e) => e.type)).toEqual(["ALLOWANCE_ISSUED"]);
    expect(proof.state.counts).toMatchObject({ orders: 0, attempts: 0, events: 1 });
  }, 30_000);

  it("C01 accepted plan-window boundary across a wait", async () => {
    const original = await c01AdmittedBindInput({ validForMs: 60_000 });
    const [clock] = await c01Sql<
      { deadline: Date | string }[]
    >`SELECT clock_timestamp() + interval '3 seconds' AS deadline`;
    const deadlineDate = new Date(clock!.deadline);
    expect(Number.isFinite(deadlineDate.getTime())).toBe(true);
    const deadline = deadlineDate.toISOString();
    const input = {
      ...original,
      plan: {
        ...original.plan,
        timingWindow: { ...original.plan.timingWindow, closesAtUtc: deadline },
      },
    };
    expect(validateExecutionPolicyBindingV2(input.policy)).toBe(true);
    const before = await c01LockProofState(input);
    const trace: C01LockTrace = [{ kind: "before", state: before, deadline }];
    const holder = c01LockClient("plan-window-holder", trace, {
      resource: "account",
      identity: input.allowance.accountId,
    });
    const binder = c01LockClient("plan-window-bind", trace);
    const operations: Promise<unknown>[] = [];
    let proof!: Awaited<ReturnType<typeof c01FinishProof>>;
    try {
      operations.push(
        c01Settled(
          holder.db.transaction(async (tx) => {
            await tx
              .select()
              .from(schema.traderRiskAccountStateV2)
              .where(
                and(
                  eq(schema.traderRiskAccountStateV2.organizationId, c01Org),
                  eq(schema.traderRiskAccountStateV2.accountId, input.allowance.accountId),
                ),
              )
              .for("update");
          }),
        ),
      );
      await expect.poll(() => holder.paused, { timeout: 5_000 }).toBe(true);
      operations.push(
        c01Settled(bindExecutionAuthorityV2Postgres(binder.db, { organizationId: c01Org }, input)),
      );
      await c01ObserveAccountWait(holder, binder, trace);
      await c01WaitPastDeadline(holder, deadline, trace);
    } catch (error) {
      trace.push({ kind: "harness-failure", causes: c01NativeCauses(error) });
      throw error;
    } finally {
      proof = await c01FinishProof(
        "plan-window/account-wait",
        input,
        trace,
        [binder, holder],
        operations,
      );
    }
    c01Receipt("plan-window-classification", {
      outcomes: proof.outcomes,
      before,
      after: proof.state,
    });
    expect(proof.outcomes).toMatchObject([
      { ok: true },
      {
        ok: false,
        error: expect.any(ExecutionV2AuthorityRefusedError),
        causes: expect.arrayContaining([
          expect.objectContaining({ reason: "EXECUTION_WINDOW_CLOSED" }),
        ]),
      },
    ]);
    expect(proof.state).toEqual(before);
    expect(proof.state.allowance[0]).toMatchObject({ lifecycle_state: "ISSUED" });
    expect(proof.state.counts).toMatchObject({ orders: 0, attempts: 0, reports: 0 });
  }, 30_000);
});
