import { afterEach, describe, expect, it, vi } from "vitest";
import { HtxBarPollSource } from "@/lib/trader/market-data/htx-bar-poll-source";
import { createEmptyHypothesisSessionState } from "@/lib/trader/intelligence/mi-core.types";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import { recordedPublicTransport } from "../helpers/recorded-paper-public-transport";
import { captureSession, copy, digest, seal, ANALYSIS_CONTRACT, type AnalysisPacket, captureRecordedLoop } from "@/lib/trader/paper/durable-noncapital/recorded-analysis-v1";
import { captureMandatoryBundle, normalizeMandatory } from "@/lib/trader/paper/durable-noncapital/normalize-mandatory-packet-v1";
import { evaluateRecordedAnalysis } from "@/lib/trader/paper/durable-noncapital/evaluate-recorded-analysis-v1";
import { parseRecordedPaperOptions } from "@/lib/trader/paper/durable-noncapital/cli-options-v1";
const now = Date.parse("2026-09-26T12:00:30.000Z");
const config = { organizationId: "11111111-1111-4111-8111-111111111111", accountId: "internal", symbol: "BTC/USDT", sessionId: "fixture-session",
  releaseSha: "a".repeat(40), maxPacketBytes: 1_000_000, maxBarsPerInterval: 30, maxCycles: 2, leaseDurationMs: 180_000 };
async function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const session = captureSession(config); const requests: string[] = [];
  const pending = new HtxBarPollSource({ internalSymbol: session.symbol, fetchImpl: recordedPublicTransport(() => now, p => requests.push(p)), disableOptionalProviders: true }).fetchMandatoryEvaluationBundle();
  await vi.runAllTimersAsync(); const bundle = await pending;
  const captured = captureMandatoryBundle(bundle, session); const pit = new Date(Date.now() + 100).toISOString();
  const normalized = normalizeMandatory(captured, session, pit); const previousState = createEmptyHypothesisSessionState();
  const packet: AnalysisPacket = seal({ schemaVersion: ANALYSIS_CONTRACT, session, sequence: 0, analysisPitAnchor: pit, normalized,
    previousState, previousStateDigest: digest(previousState), previousCompletionDigest: null, sources: [] });
  return { session, bundle, captured, normalized, packet, requests, pit };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("DEE1121 actual source normalization and fixed observational evaluator", () => {
  it("retains exact closed full bars and exclusion manifests, replacing the old open-bar summary", async () => {
    const f = await fixture(); expect(f.requests).toHaveLength(8);
    expect(f.bundle.snapshot.bars).toHaveLength(25); expect(f.normalized.bars["1m"]).toHaveLength(24);
    expect(f.normalized.excludedOpenBars).toHaveLength(5);
    expect(f.normalized.bars["1m"]).toEqual(f.bundle.snapshot.bars.slice(0, 24));
    expect(f.normalized.observations[0]!.payload.barCount).toBe(24);
    expect(digest(f.normalized.observations[0])).not.toBe(digest(f.bundle.canonicalPitCandidates[0]));
    expect(f.normalized.scheduledBarCloseTime).toBe("2026-09-26T12:00:00.000Z");
    expect(f.normalized.fusedContext.fusedAtUtc).toBe(f.pit);
  });
  it("runs the real evaluator deterministically with explicit missing authority and unchanged predecessor", async () => {
    const { packet } = await fixture(); const before = copy(packet);
    const first = evaluateRecordedAnalysis(packet); expect(evaluateRecordedAnalysis(packet)).toEqual(first); expect(packet).toEqual(before);
    expect(first.authority).toBe("OBSERVATIONAL_ONLY"); expect(first.evaluation.understandingArtifact).toBeUndefined();
    // Full actual output identity captured before the canonical service closure repair.
    expect(first.contentDigest).toBe("874c8f791b6743f97537a0600f0d4068454c83fcedf733cd079193a3c24294b2");
    expect(first.evaluation.canonicalRuntimeIntelligenceState).toBeUndefined();
    expect(first.evaluation.intelligenceCycleBundle).toBeUndefined();
    expect(first.evaluation.forecastDecisionBundle).toBeUndefined();
    expect(first.evaluation.forecastRuntimeOutcome?.status).toBe("NON_ACTIONABLE");
    expect(first.evaluation.reconstruction).toBeDefined(); expect(first.evaluation.decisionChain).toBeDefined(); expect(first.idCount).toBeGreaterThan(0);
    let ordinal = 0;
    const actual = runEvaluationCycle({ organizationId: packet.session.organizationId, accountId: packet.session.accountId, symbol: packet.session.symbol,
      bars: packet.normalized.bars["1m"]!, quote: packet.normalized.quote, fusedContext: packet.normalized.fusedContext,
      evaluatedAt: packet.analysisPitAnchor, miCoreEnabled: true, omitIntelligenceArtifacts: false, hypothesisSessionState: copy(packet.previousState),
      strategySignalIds: packet.session.registry.map(x => x.strategyId), newId: () => `recorded-analysis:${digest({ packet: packet.contentDigest,
        contract: ANALYSIS_CONTRACT, predecessor: packet.previousStateDigest, ordinal: ordinal++ })}` });
    expect(first.evaluation).toEqual(copy(actual));
  });
  it("preserves gaps and never silently fills or truncates a complete closed lane", async () => {
    const f = await fixture(); f.captured.bars["1m"]!.splice(2, 1);
    const r = normalizeMandatory(f.captured, f.session, f.pit); expect(r.bars["1m"]).toHaveLength(23);
    expect(r.bars["1m"]![2]!.barOpenTime).toBe(f.normalized.bars["1m"]![3]!.barOpenTime);
  });
  it.each(["organization", "symbol", "interval", "duplicate", "order", "negative", "nan", "future-quote", "future-ingest", "quote-payload", "duplicate-observation", "missing-source", "optional-source", "excess-bars"])("refuses %s before publishing", async kind => {
    const f = await fixture();
    if (kind === "organization") f.session.organizationId = f.session.organizationId.toUpperCase().replace("1111", "AAAA");
    if (kind === "symbol") f.captured.bars["1m"]![1]!.symbol = "ETH/USDT";
    if (kind === "interval") f.captured.bars["1m"]![1]!.interval = "1h";
    if (kind === "duplicate") f.captured.bars["1m"]![1] = f.captured.bars["1m"]![0]!;
    if (kind === "order") f.captured.bars["1m"]!.reverse();
    if (kind === "negative") f.captured.bars["1m"]![0]!.volume = "-1";
    if (kind === "nan") f.captured.observations[0]!.latencyMs = NaN;
    if (kind === "future-quote") f.captured.quote.timestamp = "2030-01-01T00:00:00.000Z";
    if (kind === "future-ingest") f.captured.observations[0]!.provenance.ingestTimeUtc = "2030-01-01T00:00:00.000Z";
    if (kind === "quote-payload") f.captured.quote.bid = "99";
    if (kind === "duplicate-observation") f.captured.observations.push(f.captured.observations[0]!);
    if (kind === "missing-source") f.captured.observations.pop();
    if (kind === "optional-source") f.captured.observations.push({ ...f.captured.observations[0]!, kind: "fear_greed_index" });
    if (kind === "excess-bars") f.session.maxBarsPerInterval = 20;
    expect(() => { if (kind === "organization") captureSession(f.session); else normalizeMandatory(f.captured, f.session, f.pit); }).toThrow();
  });
  it("strips provider exception text and unknown raw fields, preserving unavailable", async () => {
    const f = await fixture(); const o = f.bundle.canonicalPitCandidates.find(x => x.kind === "order_book_snapshot")!;
    o.health = "UNAVAILABLE"; o.payload = { unavailable: true, reason: "SECRET: response headers token", unknown: "raw" };
    const captured = captureMandatoryBundle(f.bundle, f.session); const normalized = normalizeMandatory(captured, f.session, f.pit);
    expect(JSON.stringify(normalized)).not.toContain("SECRET"); expect(JSON.stringify(normalized)).not.toContain("headers");
    expect(normalized.fusedContext.orderBookSnapshot?.health).toBe("UNAVAILABLE");
  });
  it("recomputes summary reliability at analysis PIT with retained original acquisition provenance", async () => {
    const f = await fixture(); const pit = new Date(now + 150_000).toISOString();
    for (const lane of Object.values(f.captured.bars)) lane.pop();
    const r = normalizeMandatory(f.captured, f.session, pit);
    expect(r.fusedContext.primaryQuote?.health).toBe("STALE");
    expect(r.fusedContext.orderBookSnapshot?.freshnessMs).toBe(150_000);
    expect(r.fusedContext.orderBookSnapshot?.provenance.ingestTimeUtc).toBe(f.captured.observations.find(o => o.kind === "order_book_snapshot")!.provenance.ingestTimeUtc);
  });
  it.each(["registry", "normalization", "state", "digest", "environment"])("refuses altered %s", async kind => {
    const f = await fixture();
    if (kind === "environment") vi.stubEnv("FHV_IDHPS_SKIP_REGIME_TIMELINE", "1");
    if (kind === "registry") f.packet.session.registry = [...f.packet.session.registry].reverse();
    if (kind === "normalization") f.packet.normalized.quote.bid = "90";
    if (kind === "state") f.packet.previousStateDigest = "f".repeat(64);
    if (kind === "digest") f.packet.contentDigest = "f".repeat(64);
    expect(() => evaluateRecordedAnalysis(f.packet)).toThrow();
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER, Infinity])( "rejects unsafe requested sequence range %s", startSequence => {
    expect(() => captureRecordedLoop({ ...config, startSequence })).toThrow();
  });
  it("has no ambient random/clock dependency in the fixed analytical call, across node modes", async () => {
    const f = await fixture(); const initial = evaluateRecordedAnalysis(f.packet);
    const random = vi.spyOn(crypto, "randomUUID").mockImplementation(() => { throw new Error("AMBIENT_RANDOM"); });
    const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("AMBIENT_CLOCK"); });
    try {
      for (const nodeEnv of ["production", "test"]) for (const flag of ["0", "1"]) {
        vi.stubEnv("NODE_ENV", nodeEnv); vi.stubEnv("WAIA_MI_CORE_ENABLED", flag);
        expect(evaluateRecordedAnalysis(f.packet)).toEqual(initial);
      }
    } finally { random.mockRestore(); clock.mockRestore(); }
  });
  it.each(["body-extra", "observation-extra", "payload-extra", "bar-punctuation", "future-open", "wrong-duration"])("rejects %s without silently accepting a different stored contract", async kind => {
    const f = await fixture();
    if (kind === "body-extra") Object.assign(f.captured, { rawHttp: "secret" });
    if (kind === "observation-extra") Object.assign(f.captured.observations[0]!, { headers: "secret" });
    if (kind === "payload-extra") f.captured.observations[0]!.payload.headers = "secret";
    if (kind === "bar-punctuation") f.captured.bars["1m"]![0]!.volume = ".";
    if (kind === "future-open") f.captured.bars["1m"]!.at(-1)!.barOpenTime = "2030-01-01T00:00:00.000Z";
    if (kind === "wrong-duration") f.captured.bars["1m"]![0]!.barOpenTime = "2026-09-26T11:35:30.000Z";
    expect(() => normalizeMandatory(f.captured, f.session, f.pit)).toThrow();
  });
  it("requires explicit bounded CLI configuration and refuses arbitrary evaluator/result options", () => {
    expect(() => parseRecordedPaperOptions(["--durable-noncapital"])).toThrow("INVALID_NONCAPITAL_FLAGS");
    expect(() => parseRecordedPaperOptions(["--durable-noncapital", "--evaluator=x"])).toThrow("INVALID_NONCAPITAL_FLAGS");
  });
});
