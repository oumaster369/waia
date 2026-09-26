import { prepareCanonicalPitAttemptV1 } from "@/lib/trader/market-data/normalization/gateway-to-canonical-pit";
import { findSourceByLogicalKeyPostgres } from "@/lib/trader/mi/repository-postgres";
import { resolveAndPersistTrustAsOfV1Postgres } from "@/lib/trader/mi/trust-as-of-repository-postgres";
import { persistCanonicalAvailableGatewayV1Postgres } from "@/lib/trader/mi/canonical-pit-repository-postgres";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema.postgres";
import { seedWp13User } from "./wp13-intelligence-test-helpers";
import { createPostgresMiSourceProvenanceService } from "@/lib/trader/mi/source-provenance-service";
import { HtxBarPollSource } from "@/lib/trader/market-data/htx-bar-poll-source";
import { recordedPublicTransport, assertRecordedAnalysisTestDatabase } from "../helpers/recorded-paper-public-transport";
import { awaitRecordedBundleDatabaseClock } from "../helpers/recorded-paper-clock-barrier";
import { captureSession, copy, seal, ANALYSIS_CONTRACT, type AnalysisSession } from "@/lib/trader/paper/durable-noncapital/recorded-analysis-v1";
import { captureMandatoryBundle, normalizeMandatory } from "@/lib/trader/paper/durable-noncapital/normalize-mandatory-packet-v1";
import { publishRecordedAnalysis, readRecordedAnalysis, verifyRecordedSources, encodeBody, holderColumns } from "@/lib/trader/paper/durable-noncapital/repository-postgres-v1";
import { completeRecordedAnalysisPostgresV1, commitRecordedNoncapitalCyclePostgresV2 } from "@/lib/trader/runtime-v2/noncapital-cycle-owner-postgres-v2";
import { claimRuntimeControlLeaseAtDatabaseTimeV2, readRuntimeDatabaseClockV2, type DatabaseClockRuntimeHolderV2 } from "@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2";
import { evaluateRecordedAnalysis } from "@/lib/trader/paper/durable-noncapital/evaluate-recorded-analysis-v1";

const url = process.env.DATABASE_URL_POSTGRES?.trim(); const enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url;
const children = new Set<ChildProcess>(); const fault = "dee1121_injected_fault";
const tables = ["trader_recorded_analysis_sessions_v1", "trader_recorded_analysis_packets_v1", "trader_runtime_noncapital_cycles_v2", "trader_recorded_analysis_companions_v1"];
type ClockBarrier = Awaited<ReturnType<typeof awaitRecordedBundleDatabaseClock>>;
function assertClockBarriers(event: { clockBarriers?: ClockBarrier[] }, count: number) {
  expect(event.clockBarriers).toHaveLength(count);
  for (const proof of event.clockBarriers!) {
    expect(Date.parse(proof.observedDatabaseTimeUtc)).toBeGreaterThanOrEqual(Date.parse(proof.maxIngestTimeUtc));
    expect(proof.bundleDigest).toMatch(/^[0-9a-f]{64}$/); expect(proof.samples).toBeGreaterThanOrEqual(1);
  }
  console.info({ kind: "fixture_observed_clock_barriers", proofs: event.clockBarriers });
}
function worker(payload: object) {
  const child = spawn(process.execPath, ["--import", "tsx", "--conditions=react-server", "tests/helpers/recorded-paper-analysis-process.ts"], {
    cwd: process.cwd(), env: { PATH: process.env.PATH, CI: process.env.CI, WAIA_PG_INTEGRATION: process.env.WAIA_PG_INTEGRATION, NODE_ENV: "test", WAIA_TRADER_CLI: "1", WAIA_POSTGRES_CLI: "1",
      WAIA_DB_BACKEND: "postgres", DATABASE_URL_POSTGRES: url, WAIA_RECORDED_TEST_PAYLOAD: JSON.stringify(payload) }, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child); let buffer = ""; let errors = "";
  const result = new Promise<{ event: string; outcome?: string; digest?: string; fetches: number; clockBarriers?: ClockBarrier[]; legacyLoaded?: boolean; mockLoaded?: boolean; claim?: unknown; result: { status: string; completed: Array<{ outcome: string; packetDigest: string; companionDigest: string }> } }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CHILD_TIMEOUT:${errors}`)), 100_000);
    child.stdout!.on("data", chunk => { buffer += String(chunk); const lines = buffer.split("\n"); buffer = lines.pop()!;
      for (const line of lines) { try { const data = JSON.parse(line); if (data.event === "result" || data.event === "error") { clearTimeout(timer); resolve(data); } } catch {} } });
    child.stderr!.on("data", chunk => { errors += String(chunk); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", code => { clearTimeout(timer); if (code && !buffer) reject(new Error(`CHILD_EXIT:${code}:${errors}`)); });
  });
  return { child, result };
}
async function stop(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; }
  children.delete(child);
}
describe.skipIf(!enabled)("Postgres actual durable noncapital paper analysis", () => {
  let client: postgres.Sql; let db: ReturnType<typeof drizzle<typeof schema>>; let organizationId: string; let userId: string;
  const session = (overrides: Partial<AnalysisSession> = {}) => captureSession({ organizationId, accountId: "internal-paper", symbol: "BTC/USDT",
    sessionId: "recorded-session", releaseSha: "a".repeat(40), maxPacketBytes: 2_000_000, maxBarsPerInterval: 30, maxCycles: 1, leaseDurationMs: 400, ...overrides });
  const claim = async (durationMs = 30_000) => { const holder = await claimRuntimeControlLeaseAtDatabaseTimeV2(db, { organizationId, runtimeInstanceId: randomUUID(), durationMs }); expect(holder).not.toBeNull(); return holder!; };
  async function expiry() { await client`SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM valid_until_utc - clock_timestamp())) + 0.02) FROM trader_runtime_control_lease_heads_v2 WHERE organization_id=${organizationId}::uuid`; }
  async function collect(s: AnalysisSession) {
    const source = new HtxBarPollSource({ internalSymbol: s.symbol, disableOptionalProviders: true, fetchImpl: recordedPublicTransport(() => Date.now()) });
    const bundle = await source.fetchMandatoryEvaluationBundle();
    await awaitRecordedBundleDatabaseClock(bundle, () => db.transaction(tx => readRuntimeDatabaseClockV2(tx)));
    const pit = await db.transaction(tx => readRuntimeDatabaseClockV2(tx));
    return { pit, normalized: normalizeMandatory(captureMandatoryBundle(bundle, s), s, pit) };
  }
  async function published(s = session(), holder?: DatabaseClockRuntimeHolderV2) {
    const data = await collect(s); holder ??= await claim();
    return { s, holder, packet: await publishRecordedAnalysis(client, s, holder, 0, data.pit, data.normalized) };
  }
  async function counts() {
    return Promise.all(tables.map(async table => Number((await client.unsafe(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id=$1::uuid`, [organizationId]))[0]!.n)));
  }
  async function clearFault() {
    for (const table of tables) await client.unsafe(`DROP TRIGGER IF EXISTS ${fault} ON ${table}`);
    await client.unsafe(`DROP FUNCTION IF EXISTS ${fault}()`);
  }
  async function faultAt(table: string, timing: "BEFORE" | "AFTER", body = "RAISE EXCEPTION 'DEE1121_FAULT';") {
    expect(tables).toContain(table);
    await client.unsafe(`CREATE FUNCTION ${fault}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id='${organizationId}'::uuid THEN ${body} END IF; RETURN NEW; END $$`);
    await client.unsafe(`CREATE TRIGGER ${fault} ${timing} INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fault}()`);
  }
  async function seedSources(status: "active" | "deprecated" = "active") {
    const service = createPostgresMiSourceProvenanceService(db);
    for (const feedKind of ["ohlcv_bar", "quote_l1", "order_book_snapshot", "market_trades_snapshot"]) {
      const source = await service.createSource({ organizationId, userId }, { venue: "htx", feedKind, symbol: "BTC/USDT", status });
      await service.appendTrustRevision({ organizationId, userId }, { sourceId: source.id, trustScore: "0.7", rationale: "isolated source fixture", recordedBy: "test",
        eventTime: new Date("2026-01-01T00:00:00.000Z"), ingestTime: new Date("2026-01-01T00:00:00.000Z") });
    }
  }
  beforeAll(() => {
    assertRecordedAnalysisTestDatabase(url);
    client = postgres(url!, { max: 4 }); db = drizzle(client, { schema });
  });
  beforeEach(async () => { userId = randomUUID(); organizationId = await seedWp13User(url!, userId, "DEE1121 isolated noncapital"); });
  afterEach(async () => { vi.unstubAllGlobals(); await Promise.all([...children].map(stop)); await clearFault(); });
  afterAll(async () => { await client?.end({ timeout: 3 }); });

  it("actual CLI publishes/evaluates source and restarts exact range with zero HTTP", async () => {
    await seedSources(); const input = { ...session({ leaseDurationMs: 2_000 }), startSequence: 0 };
    const first = worker({ operation: "cli", input }); const event = await first.result; expect(event.event).toBe("result"); expect(event.result.status).toBe("COMPLETE"); expect(event.fetches).toBe(8); expect(event.legacyLoaded).toBe(false); expect(event.mockLoaded).toBe(false);
    assertClockBarriers(event, 1);
    const saved = await readRecordedAnalysis(client, captureSession(input), 0);
    expect(saved.packet!.sources.filter(s => s.receipt.status === "AVAILABLE").length).toBeGreaterThanOrEqual(3);
    expect(saved.packet!.sources.some(s => s.receipt.reason === "SOURCE_UNKNOWN")).toBe(false);
    expect(saved.companion!.output).toEqual(evaluateRecordedAnalysis(saved.packet!)); expect(saved.companion!.output.evaluation.understandingArtifact).toBeUndefined();
    await expiry(); const again = worker({ operation: "cli", input, forbidFetch: true }); const replay = await again.result;
    expect(replay.result.status).toBe("COMPLETE"); expect(replay.result.completed[0].outcome).toBe("REPLAYED"); expect(replay.fetches).toBe(0);
    assertClockBarriers(replay, 0);
    expect(replay.result.completed[0].companionDigest).toBe(saved.companion!.contentDigest); expect(await counts()).toEqual([1, 1, 1, 1]);
  }, 20_000);
  it("actual executable reports lease busy and exits nonzero before source acquisition", async () => {
    await claim(); const input = session();
    const flags = ["--durable-noncapital", ...Object.entries({ "org-id": input.organizationId, "account-key": input.accountId,
      symbol: input.symbol, "session-id": input.sessionId, "release-sha": input.releaseSha, "start-sequence": 0,
      "max-cycles": input.maxCycles, "max-packet-bytes": input.maxPacketBytes, "max-bars-per-interval": input.maxBarsPerInterval,
      "lease-duration-ms": input.leaseDurationMs }).map(([key, value]) => `--${key}=${value}`)];
    const transportGuard = `data:text/javascript,${encodeURIComponent("let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('ENTRY_TRANSPORT_FORBIDDEN')};process.on('exit',()=>console.info(JSON.stringify({kind:'entry_transport',calls})))")}`;
    const child = spawn(process.execPath, ["--import", "tsx", "--import", transportGuard, "--conditions=react-server", "scripts/trader/paper-bar-close-loop.ts", ...flags], {
      cwd: process.cwd(), env: { PATH: process.env.PATH, NODE_ENV: "test", WAIA_TRADER_CLI: "1", WAIA_POSTGRES_CLI: "1",
        WAIA_DB_BACKEND: "postgres", DATABASE_URL_POSTGRES: url }, stdio: ["ignore", "pipe", "pipe"] });
    children.add(child); let output = ""; let errors = "";
    child.stdout!.on("data", chunk => { output += String(chunk); }); child.stderr!.on("data", chunk => { errors += String(chunk); });
    const [code] = await once(child, "close"); expect(code).toBe(1); expect(errors).toBe("");
    const records = output.trim().split("\n").map(line => JSON.parse(line));
    expect(records.find(row => row.kind === "entry_transport")).toEqual({ kind: "entry_transport", calls: 0 });
    const result = records.find(row => row.kind === "durable_noncapital_analysis");
    expect(result).toEqual({ kind: "durable_noncapital_analysis", status: "LEASE_BUSY", completed: [] });
    expect(await counts()).toEqual([0, 0, 0, 0]);
  });
  it("actual CLI resumes a published input without transport or choosing another PIT", async () => {
    const s = session({ leaseDurationMs: 2_000 }); const data = await collect(s); const holder = await claim(300);
    const packet = await publishRecordedAnalysis(client, s, holder, 0, data.pit, data.normalized); await expiry();
    const child = worker({ operation: "cli", input: { ...s, startSequence: 0 }, forbidFetch: true }); const event = await child.result;
    expect(event.result.status).toBe("COMPLETE"); expect(event.fetches).toBe(0); expect(event.result.completed[0].packetDigest).toBe(packet.contentDigest);
    assertClockBarriers(event, 0);
    expect((await readRecordedAnalysis(client, s, 0)).packet!.analysisPitAnchor).toBe(packet.analysisPitAnchor);
  }, 20_000);
  it.each(["unknown", "inactive", "foreign"])("records honest %s sources without inventing qualified authority", async kind => {
    if (kind === "inactive") await seedSources("deprecated");
    if (kind === "foreign") { const original = organizationId; const originalUser = userId; userId = randomUUID(); organizationId = await seedWp13User(url!, userId, "foreign-source"); await seedSources(); organizationId = original; userId = originalUser; }
    const f = await published(); const result = await completeRecordedAnalysisPostgresV1(client, f.s, f.holder, 0);
    expect(result.packet.sources.every(s => s.receipt.status !== "AVAILABLE")).toBe(true);
    expect(result.receipt.result.status).toBe("NO_TRADE"); expect(result.companion.output.authority).toBe("OBSERVATIONAL_ONLY");
  });
  it.each(["payload", "ingestTime"] as const)("refuses canonical %s drift behind a valid writer's claimed normalized digest", async drift => {
    await seedSources(); const s = session(); const data = await collect(s); const holder = await claim();
    const normalized = data.normalized.observations.find(o => o.kind === "quote_l1")!;
    const attempt = prepareCanonicalPitAttemptV1(normalized, { pitCutoffUtc: data.pit }); expect(attempt.status).toBe("AVAILABLE");
    const context = { organizationId };
    const source = await findSourceByLogicalKeyPostgres(db, context, "htx", "quote_l1", s.symbol); expect(source).not.toBeNull();
    const trust = await resolveAndPersistTrustAsOfV1Postgres(db, context, { sourceId: source!.id, anchorTime: new Date(attempt.availableAtUtc!) });
    const stored = await persistCanonicalAvailableGatewayV1Postgres(db, context, {
      sourceId: source!.id, observationKind: attempt.kind!, subjectRef: attempt.subjectRef!, canonicalProviderId: attempt.providerId,
      payloadCanonical: drift === "payload" ? { ...attempt.payloadCanonical!, last: "999999.00000000" } : attempt.payloadCanonical!,
      eventTime: new Date(attempt.eventTimeUtc!), availableAt: new Date(attempt.availableAtUtc!),
      ingestTime: new Date(Date.parse(attempt.ingestTimeUtc!) + (drift === "ingestTime" ? 60_000 : 0)),
      trustAsOfReceiptId: trust.receipt.id, normalizedInputDigest: attempt.normalizedInputDigest,
    });
    expect(stored.observationInsertedNew).toBe(true); expect(stored.receipt.status).toBe("AVAILABLE");
    // Existing trusted low-level writer input is the adversarial setup, not ordinary CLI acquisition.
    await expect(publishRecordedAnalysis(client, s, holder, 0, data.pit, data.normalized)).rejects.toThrow("SOURCE_CONSUMED_INPUT_CONFLICT");
    expect(await counts()).toEqual([0, 0, 0, 0]);
  });
  it.each(["trader_recorded_analysis_sessions_v1", "trader_recorded_analysis_packets_v1"])("%s insert failure leaves no input or completed prefix, retry succeeds", async table => {
    const s = session(); const data = await collect(s); const holder = await claim();
    await faultAt(table, "AFTER"); await expect(publishRecordedAnalysis(client, s, holder, 0, data.pit, data.normalized)).rejects.toThrow();
    expect(await counts()).toEqual([0, 0, 0, 0]); await clearFault();
    const packet = await publishRecordedAnalysis(client, s, holder, 0, data.pit, data.normalized);
    expect((await completeRecordedAnalysisPostgresV1(client, s, holder, 0)).packet.contentDigest).toBe(packet.contentDigest);
  });
  it.each([ ["trader_runtime_noncapital_cycles_v2", "BEFORE"], ["trader_runtime_noncapital_cycles_v2", "AFTER"],
    ["trader_recorded_analysis_companions_v1", "BEFORE"], ["trader_recorded_analysis_companions_v1", "AFTER"] ] as const)("%s %s failure rolls back both completion records and valid retry", async (table, timing) => {
    const f = await published(); await faultAt(table, timing);
    await expect(completeRecordedAnalysisPostgresV1(client, f.s, f.holder, 0)).rejects.toThrow(); expect(await counts()).toEqual([1, 1, 0, 0]);
    await clearFault(); expect((await completeRecordedAnalysisPostgresV1(client, f.s, f.holder, 0)).outcome).toBe("COMMITTED");
    expect((await completeRecordedAnalysisPostgresV1(client, f.s, f.holder, 0)).outcome).toBe("REPLAYED"); expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("v2-only records keep old replay semantics but cannot be enriched by new completion", async () => {
    const f = await published(); const input = { organizationId, accountId: f.s.accountId, releaseSha: f.s.releaseSha, bar: f.packet.normalized.bars["1m"]!.at(-1)! };
    expect((await commitRecordedNoncapitalCyclePostgresV2(db, { organizationId }, f.holder, input)).outcome).toBe("COMMITTED");
    await expect(completeRecordedAnalysisPostgresV1(client, f.s, f.holder, 0)).rejects.toThrow("LEGACY_ONLY_OWNER_CONFLICT");
    expect((await commitRecordedNoncapitalCyclePostgresV2(db, { organizationId }, f.holder, input)).outcome).toBe("REPLAYED"); expect(await counts()).toEqual([1, 1, 1, 0]);
  });
  it("explicit replay refuses a self-consistently sealed different analytical output without rewriting history", async () => {
    const f = await published();
    const terminal = await commitRecordedNoncapitalCyclePostgresV2(db, { organizationId }, f.holder, {
      organizationId, accountId: f.s.accountId, releaseSha: f.s.releaseSha, bar: f.packet.normalized.bars["1m"]!.at(-1)!,
    });
    const original = evaluateRecordedAnalysis(f.packet);
    const outputBody = { ...original }; delete (outputBody as Partial<typeof original>).contentDigest;
    outputBody.evaluation.features.featureSetId = "self-consistent-but-not-command-produced";
    const output = seal(outputBody);
    const companion = seal({ schemaVersion: ANALYSIS_CONTRACT, organizationId, sessionId: f.s.sessionId, sequence: 0,
      packetDigest: f.packet.contentDigest, previousCompletionDigest: null, canonicalReceiptDigest: terminal.receipt.contentDigest, output });
    // Adversarial privileged fixture satisfies current SQL integrity links; it is not an application writer.
    await db.insert(schema.traderRecordedAnalysisCompanionsV1).values({ organizationId, sessionId: f.s.sessionId, sequence: 0,
      packetDigest: f.packet.contentDigest, accountId: f.s.accountId, symbol: f.s.symbol, barInterval: "1m",
      scheduledBarCloseTime: f.packet.normalized.scheduledBarCloseTime, contentDigest: companion.contentDigest,
      bodyJson: encodeBody(companion), ...holderColumns(f.holder) });
    expect((await readRecordedAnalysis(client, f.s, 0)).companion!.contentDigest).toBe(companion.contentDigest);
    await expect(completeRecordedAnalysisPostgresV1(client, f.s, f.holder, 0)).rejects.toThrow("ANALYTICAL_REPLAY_CONFLICT");
    expect((await readRecordedAnalysis(client, f.s, 0)).companion!.contentDigest).toBe(companion.contentDigest);
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("two native child processes share one completion under a pre-existing repeatable-read default", async () => {
    const f = await published(); const gate = postgres(url!, { max: 1 });
    await gate`BEGIN`; await gate`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId},637))`;
    const names = [randomUUID(), randomUUID()]; const workers = names.map(applicationName => worker({ operation: "complete", applicationName, input: { ...f.s, startSequence: 0 }, holder: f.holder }));
    try {
      for (let i = 0; i < 500; i++) { const n = (await client`SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=ANY(${names}::text[]) AND wait_event='advisory'`)[0]!.n; if (n === 2) break; await new Promise(r => setTimeout(r, 10)); }
      expect((await client`SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=ANY(${names}::text[]) AND wait_event='advisory'`)[0]!.n).toBe(2);
      await gate`ROLLBACK`; const outcomes = await Promise.all(workers.map(w => w.result)); expect(outcomes.map(o => o.outcome).sort()).toEqual(["COMMITTED", "REPLAYED"]);
      expect(outcomes[0]!.digest).toBe(outcomes[1]!.digest); expect(await counts()).toEqual([1, 1, 1, 1]);
    } finally { await gate`ROLLBACK`.catch(() => {}); await gate.end({ timeout: 2 }); }
  }, 20_000);
  it.each([
    ["trader_runtime_noncapital_cycles_v2", "BEFORE", false],
    ["trader_runtime_noncapital_cycles_v2", "AFTER", false],
    ["trader_recorded_analysis_companions_v1", "AFTER", false],
    ["trader_recorded_analysis_companions_v1", "AFTER", true],
  ] as const)("native crash at %s %s deferred=%s leaves the packet and no partial completion", async (table, timing, deferred) => {
    const f = await published(); const gate = postgres(url!, { max: 1 }); const applicationName = randomUUID();
    const key = 11210099; await gate`BEGIN`; await gate`SELECT pg_advisory_xact_lock(${key})`;
    await faultAt(table, timing, `PERFORM pg_advisory_xact_lock(${key});`);
    if (deferred) { await client.unsafe(`DROP TRIGGER ${fault} ON ${table}`); await client.unsafe(`CREATE CONSTRAINT TRIGGER ${fault} AFTER INSERT ON ${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${fault}()`); }
    const process = worker({ operation: "complete", applicationName, input: { ...f.s, startSequence: 0 }, holder: f.holder });
    process.result.catch(() => undefined);
    try {
      let waiting = false;
      for (let i = 0; i < 500; i++) { waiting = (await client`SELECT pid FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event='advisory'`).length === 1; if (waiting) break; await new Promise(r => setTimeout(r, 10)); }
      expect(waiting).toBe(true); expect(await counts()).toEqual([1, 1, 0, 0]);
      await stop(process.child); await gate`ROLLBACK`;
      for (let i = 0; i < 300; i++) { if (!(await client`SELECT pid FROM pg_stat_activity WHERE application_name=${applicationName}`).length) break; await new Promise(r => setTimeout(r, 10)); }
      expect((await client`SELECT pid FROM pg_stat_activity WHERE application_name=${applicationName}`).length).toBe(0);
      const durable = await counts();
      if (deferred) expect([[1, 1, 0, 0], [1, 1, 1, 1]]).toContainEqual(durable);
      else expect(durable).toEqual([1, 1, 0, 0]);
      await clearFault();
      expect((await completeRecordedAnalysisPostgresV1(client, f.s, f.holder, 0)).outcome).toBe(durable[2] === 0 ? "COMMITTED" : "REPLAYED");
      expect(await counts()).toEqual([1, 1, 1, 1]);
    } finally { await gate`ROLLBACK`.catch(() => {}); await gate.end({ timeout: 2 }); }
  }, 20_000);
  it("a process killed after commit replays the exact result in a new process", async () => {
    const f = await published(); const first = worker({ operation: "complete", input: { ...f.s, startSequence: 0 }, holder: f.holder, holdAfterResult: true });
    const committed = await first.result; expect(committed.outcome).toBe("COMMITTED"); await stop(first.child);
    const next = worker({ operation: "complete", input: { ...f.s, startSequence: 0 }, holder: f.holder, forbidFetch: true });
    const replay = await next.result; expect(replay.outcome).toBe("REPLAYED"); expect(replay.digest).toBe(committed.digest); expect(replay.fetches).toBe(0);
  });
  it("its own deferred fence refuses expiry after the last application check", async () => {
    const s = session(); const data = await collect(s); const holder = await claim(900);
    await publishRecordedAnalysis(client, s, holder, 0, data.pit, data.normalized);
    await faultAt("trader_recorded_analysis_companions_v1", "AFTER", "PERFORM pg_sleep(1.0);");
    await client.unsafe(`DROP TRIGGER ${fault} ON trader_recorded_analysis_companions_v1`);
    await client.unsafe(`CREATE CONSTRAINT TRIGGER ${fault} AFTER INSERT ON trader_recorded_analysis_companions_v1 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${fault}()`);
    await expect(completeRecordedAnalysisPostgresV1(client, s, holder, 0)).rejects.toThrow(); expect(await counts()).toEqual([1, 1, 0, 0]);
    await clearFault(); const next = await claim(); expect((await completeRecordedAnalysisPostgresV1(client, s, next, 0)).outcome).toBe("COMMITTED");
  });
  it.each(["trader_recorded_analysis_sessions_v1", "trader_recorded_analysis_packets_v1"])("%s has an independent default-deferred publication fence", async table => {
    const s = session(); const data = await collect(s); const holder = await claim(900);
    await faultAt(table, "AFTER", "PERFORM pg_sleep(1.0);");
    await client.unsafe(`DROP TRIGGER ${fault} ON ${table}`);
    await client.unsafe(`CREATE CONSTRAINT TRIGGER ${fault} AFTER INSERT ON ${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${fault}()`);
    await expect(publishRecordedAnalysis(client, s, holder, 0, data.pit, data.normalized)).rejects.toThrow("RUNTIME_CONTROL_LEASE_STALE_HOLDER");
    expect(await counts()).toEqual([0, 0, 0, 0]); await clearFault();
    const replacement = await claim(); await publishRecordedAnalysis(client, s, replacement, 0, data.pit, data.normalized);
    expect(await counts()).toEqual([1, 1, 0, 0]);
  });
  it("a new session cannot create another companion at the occupied v2 key", async () => {
    const f = await published(); await completeRecordedAnalysisPostgresV1(client, f.s, f.holder, 0);
    const other = captureSession({ ...f.s, sessionId: "another-recorded-session" });
    await publishRecordedAnalysis(client, other, f.holder, 0, f.packet.analysisPitAnchor, f.packet.normalized);
    await expect(completeRecordedAnalysisPostgresV1(client, other, f.holder, 0)).rejects.toThrow("LEGACY_ONLY_OWNER_CONFLICT");
    expect(await counts()).toEqual([2, 2, 1, 1]);
    expect((await readRecordedAnalysis(client, other, 0)).companion).toBeNull();
  });
  it("captures caller scope and configuration before an awaited lock", async () => {
    const f = await published(); const mutable = copy(f.s); const gate = postgres(url!, { max: 1 });
    await gate`BEGIN`; await gate`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId},637))`;
    const pending = completeRecordedAnalysisPostgresV1(client, mutable, f.holder, 0);
    mutable.accountId = "foreign"; mutable.organizationId = randomUUID(); mutable.registry = [];
    try { await gate`ROLLBACK`; const result = await pending; expect(result.packet.session.accountId).toBe(f.s.accountId); expect(result.packet.session.organizationId).toBe(organizationId); }
    finally { await gate.end({ timeout: 2 }); }
  });
  it("two real CLI cycles follow strict minute cadence, persist predecessor and replay exact sequence range", async () => {
    const input = { ...session({ maxCycles: 2, leaseDurationMs: 70_000 }), startSequence: 0 };
    const child = worker({ operation: "cli", input }); const result = await child.result;
    expect(result.result.status).toBe("COMPLETE"); expect(result.fetches).toBe(16); expect(result.result.completed).toHaveLength(2);
    assertClockBarriers(result, 2);
    const first = await readRecordedAnalysis(client, captureSession(input), 0); const second = await readRecordedAnalysis(client, captureSession(input), 1);
    expect(second.packet!.previousCompletionDigest).toBe(first.companion!.contentDigest);
    expect(second.packet!.previousState).toEqual(first.companion!.output.nextState);
    expect(Date.parse(second.packet!.normalized.scheduledBarCloseTime)).toBeGreaterThan(Date.parse(first.packet!.normalized.scheduledBarCloseTime));
    expect(await counts()).toEqual([1, 2, 2, 2]);
    await expiry();
    const replay = await worker({ operation: "cli", input, forbidFetch: true }).result;
    expect(replay.result.status).toBe("COMPLETE"); expect(replay.fetches).toBe(0);
    assertClockBarriers(replay, 0);
    expect(replay.result.completed.map(c => c.outcome)).toEqual(["REPLAYED", "REPLAYED"]);
    expect(replay.result.completed.map(c => c.companionDigest)).toEqual([first.companion!.contentDigest, second.companion!.contentDigest]);
    expect(await counts()).toEqual([1, 2, 2, 2]);
  }, 120_000);
  it("actual CLI stops repeated source at the next cadence with no successor or prefix advance", async () => {
    const input = { ...session({ maxCycles: 2, leaseDurationMs: 90_000 }), startSequence: 0 };
    const child = worker({ operation: "cli", input, fixedSourceTime: Date.now() - 120_000 });
    const event = await child.result; expect(event.result.status).toBe("SOURCE_NOT_ADVANCED"); expect(event.result.completed).toHaveLength(1);
    assertClockBarriers(event, 2);
    expect(event.fetches).toBe(16); expect(await counts()).toEqual([1, 1, 1, 1]);
  }, 100_000);
  it("lease contention is one native process winner and one typed busy result", async () => {
    const names = [randomUUID(), randomUUID()]; const claims = names.map(applicationName => worker({ operation: "claim", applicationName,
      claim: { organizationId, runtimeInstanceId: applicationName, durationMs: 30_000 } }));
    const values = await Promise.all(claims.map(c => c.result)); expect(values.filter(v => v.claim === null)).toHaveLength(1); expect(values.filter(v => v.claim !== null)).toHaveLength(1);
  });
  it("same or regressing scheduled bars refuse publication without a successor packet", async () => {
    const f = await published(); await completeRecordedAnalysisPostgresV1(client, f.s, f.holder, 0);
    await expect(publishRecordedAnalysis(client, f.s, f.holder, 1, f.packet.analysisPitAnchor, f.packet.normalized)).rejects.toThrow("SOURCE_NOT_ADVANCED");
    expect(await counts()).toEqual([1, 1, 1, 1]);
    const changed = copy(f.packet.normalized.captured); changed.bars["1m"]!.splice(changed.bars["1m"]!.length - 2, 2);
    const prior = normalizeMandatory(changed, f.s, f.packet.analysisPitAnchor);
    await expect(publishRecordedAnalysis(client, f.s, f.holder, 1, f.packet.analysisPitAnchor, prior)).rejects.toThrow("SOURCE_NOT_ADVANCED");
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("refuses stale holders, wrong tenant, changed session config and supplied output mutations", async () => {
    const f = await published();
    await expect(completeRecordedAnalysisPostgresV1(client, f.s, { ...f.holder, leaseEpoch: f.holder.leaseEpoch + 1 }, 0)).rejects.toThrow();
    await expect(completeRecordedAnalysisPostgresV1(client, f.s, { ...f.holder, organizationId: randomUUID() }, 0)).rejects.toThrow("TENANT_MISMATCH");
    await expect(completeRecordedAnalysisPostgresV1(client, captureSession({ ...f.s, releaseSha: "b".repeat(40) }), f.holder, 0)).rejects.toThrow("SESSION_CONFIG_CONFLICT");
    const wrong = copy(f.packet); wrong.sources[0]!.receipt.normalizedInputDigest = "f".repeat(64); await expect(verifyRecordedSources(db, wrong)).rejects.toThrow();
    expect(await counts()).toEqual([1, 1, 0, 0]);
  });
  it("pool ownership rejects actual transaction and reserved handles", async () => {
    const s = session(); await client.begin(async tx => { await expect(readRecordedAnalysis(tx as unknown as postgres.Sql, s, 0)).rejects.toThrow("POOL_REQUIRED"); });
    const reserved = await client.reserve(); try { await expect(readRecordedAnalysis(reserved as unknown as postgres.Sql, s, 0)).rejects.toThrow("POOL_REQUIRED"); } finally { reserved.release(); }
  });
  it("append-only, body hash and browser roles refuse direct mutation/read", async () => {
    const f = await published(); await completeRecordedAnalysisPostgresV1(client, f.s, f.holder, 0);
    for (const table of tables) {
      await expect(client.unsafe(`DELETE FROM ${table} WHERE organization_id=$1::uuid`, [organizationId])).rejects.toThrow();
      await expect(client.unsafe(`UPDATE ${table} SET lease_epoch=lease_epoch WHERE organization_id=$1::uuid`, [organizationId])).rejects.toThrow();
    }
    const storedHeader = (await client`SELECT * FROM trader_recorded_analysis_sessions_v1 WHERE organization_id=${organizationId}::uuid`)[0]!;
    for (const role of ["authenticated", "anon"]) {
      await client.begin(async tx => {
        await tx.unsafe(`GRANT SELECT,INSERT,UPDATE,DELETE ON trader_recorded_analysis_sessions_v1,trader_recorded_analysis_packets_v1,trader_recorded_analysis_companions_v1 TO ${role}`);
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        for (const table of tables.filter(t => !t.includes("runtime_noncapital"))) expect((await tx.unsafe(`SELECT count(*)::int n FROM ${table}`))[0]!.n).toBe(0);
        await expect(tx.savepoint(async denied => {
          await denied`INSERT INTO trader_recorded_analysis_sessions_v1(organization_id,session_id,content_digest,body_json,runtime_instance_id,lease_epoch,lease_content_digest)
            VALUES(${organizationId}::uuid,${storedHeader.session_id},${storedHeader.content_digest},${storedHeader.body_json},${storedHeader.runtime_instance_id},${storedHeader.lease_epoch},${storedHeader.lease_content_digest})`;
        })).rejects.toMatchObject({ code: "42501" });
        await tx.unsafe("RESET ROLE"); throw new Error("ROLE_GRANT_ROLLBACK");
      }).catch(error => { expect(error.message).toBe("ROLE_GRANT_ROLLBACK"); });
    }
    const rows = await client`SELECT * FROM trader_recorded_analysis_packets_v1 WHERE organization_id=${organizationId}::uuid`;
    await expect(client`INSERT INTO trader_recorded_analysis_packets_v1 SELECT organization_id, session_id||'-bad', content_digest, body_json, runtime_instance_id, lease_epoch, lease_content_digest, sequence, config_digest, analysis_pit_anchor FROM trader_recorded_analysis_packets_v1 WHERE organization_id=${organizationId}::uuid`).rejects.toThrow();
    expect(rows).toHaveLength(1);
    await expect(client`INSERT INTO trader_recorded_analysis_sessions_v1(organization_id,session_id,content_digest,body_json,runtime_instance_id,lease_epoch,lease_content_digest)
      VALUES(${organizationId}::uuid,${storedHeader.session_id},${"f".repeat(64)},${storedHeader.body_json},${storedHeader.runtime_instance_id},${storedHeader.lease_epoch},${storedHeader.lease_content_digest})`).rejects.toMatchObject({ code: "23514" });
  });
});
