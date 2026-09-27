// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { researchCapturedFixture, researchPureFixture } from "../helpers/research-understanding-fixture";
import { evaluateSavedResearchUnderstanding } from "@/lib/trader/paper/research-understanding-v1/evaluate";
import { buildResearchAssignment, RESEARCH_SERVICE_ACTOR, captureProfileDefinition } from "@/lib/trader/paper/research-understanding-v1/contract";
import { copy, digest, seal } from "@/lib/trader/paper/durable-noncapital/recorded-analysis-v1";
import { computeSourceTrustDigest } from "@/lib/trader/mi/serialize-source-trust";
const evaluate = (f: ReturnType<typeof researchPureFixture>) => evaluateSavedResearchUnderstanding(f.packet, f.assignment, f.profile, f.revisions);
afterEach(() => vi.unstubAllEnvs());
describe("actual saved research existing leaf composition", () => {
  it("produces positive WHAT with both real lane requirements and all twelve honest claims", () => {
    const f = researchPureFixture(); const before = copy(f); const out = evaluate(f);
    expect(out.disposition).toBe("COMPLETED_SUPPORTED"); expect(out.receipt.status).toBe("SUFFICIENT");
    expect(out.artifact.claims).toHaveLength(12);
    expect(out.artifact.claims.filter(c => c.claimState === "SUPPORTED").map(c => c.marketQuestionId)).toEqual(["Q_WHAT_HAPPENING"]);
    expect(out.artifact.claims.filter(c => c.claimState === "NOT_APPLICABLE")).toHaveLength(2);
    expect(out.artifact.claims.filter(c => c.claimState === "UNKNOWN")).toHaveLength(9);
    expect(out.lanes.map(l => [l.lane, l.status, Boolean(l.evidenceId)])).toEqual([["1m", "TRUSTED", true], ["4h", "TRUSTED", true]]);
    expect(f).toEqual(before); expect(evaluate(f)).toEqual(out);
  });
  it("retains low measured score independently of explicit categorical admission and floor", () => {
    const f = researchPureFixture({ score: "0" }); expect(evaluate(f).disposition).toBe("COMPLETED_SUPPORTED");
    f.profileDefinition.requirements[0]!.minimumTrustScore = 0.5 as unknown as null;
    f.profile = captureProfileDefinition(f.profileDefinition);
    f.assignment = buildResearchAssignment(f.config, f.profile, { kind: "SERVICE", id: RESEARCH_SERVICE_ACTOR }, f.assignment.assignedAt);
    expect(evaluate(f).disposition).toBe("COMPLETED_UNRESOLVED");
  });
  it("keeps missing 4h explicitly UNKNOWN with no fabricated evidence ID", () => {
    const captured = researchCapturedFixture(); delete captured.bars["4h"]; captured.observations = captured.observations.filter(o => o.interval !== "4h");
    const out = evaluate(researchPureFixture({ captured })); expect(out.disposition).toBe("COMPLETED_UNRESOLVED");
    expect(out.lanes[1]).toMatchObject({ status: "UNKNOWN", evidenceId: null, fullLaneDigest: null });
  });
  it("retains canonical UNKNOWN and refuses to infer categorical trust", () => {
    const out = evaluate(researchPureFixture({ unknownTrust: true })); expect(out.disposition).toBe("COMPLETED_UNRESOLVED");
    expect(out.lanes.every(l => l.status === "UNKNOWN" && l.evidenceId === null)).toBe(true);
  });
  it("represents an unadmitted exact revision as UNTRUSTED, without changing native source truth", () => {
    const f = researchPureFixture(); const old = copy(f.revisions); f.config.admissions[1]!.revisionDigests = ["e".repeat(64)];
    f.assignment = buildResearchAssignment(f.config, f.profile, { kind: "SERVICE", id: RESEARCH_SERVICE_ACTOR }, f.assignment.assignedAt);
    const out = evaluate(f); expect(out.disposition).toBe("COMPLETED_UNRESOLVED"); expect(out.lanes[1]!.status).toBe("UNTRUSTED"); expect(f.revisions).toEqual(old);
  });
  it("rejects availableAt-only selected revision drift even though its native digest is unchanged", () => {
    const f = researchPureFixture(); const r = f.revisions[0]!; r.availableAt = "2026-01-01T00:00:00.001Z";
    expect(computeSourceTrustDigest({ ...r, eventTime: new Date(r.eventTime), ingestTime: new Date(r.ingestTime) })).toBe(r.contentDigest);
    expect(() => evaluate(f)).toThrow("SOURCE_REVISION_CHRONOLOGY_CONFLICT");
  });
  it.each(["packet", "declared-manifest", "source-payload", "source-provider", "future-ingest", "environment"])("refuses %s without a market-unavailable fallback", kind => {
    const f = researchPureFixture();
    if (kind === "packet") f.packet.contentDigest = "f".repeat(64);
    if (kind === "declared-manifest") { const a = copy(f.assignment); a.declarations.computationManifestDigest = "f".repeat(64) as typeof a.declarations.computationManifestDigest; const body = copy(a); delete (body as Partial<typeof body>).contentDigest; f.assignment = seal(body); }
    if (["source-payload", "source-provider", "future-ingest"].includes(kind)) {
      const observation = f.packet.sources[0]!.observation as Record<string, unknown>;
      if (kind === "source-payload") observation.payloadJson = "{}";
      if (kind === "source-provider") observation.canonicalProviderId = "other";
      if (kind === "future-ingest") observation.ingestTime = "2030-01-01T00:00:00.000Z";
      const body = copy(f.packet); delete (body as Partial<typeof body>).contentDigest; f.packet = seal(body);
    }
    if (kind === "environment") vi.stubEnv("FHV_IDHPS_SKIP_REGIME_TIMELINE", "1");
    expect(() => evaluate(f)).toThrow();
  });
  it("does not consult ambient clock, random IDs or miCore flags", () => {
    const f = researchPureFixture(); const expected = evaluate(f);
    const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("AMBIENT_CLOCK"); });
    const random = vi.spyOn(crypto, "randomUUID").mockImplementation(() => { throw new Error("AMBIENT_RANDOM"); });
    try { for (const flag of ["0", "1"]) { vi.stubEnv("WAIA_MI_CORE_ENABLED", flag); expect(evaluate(f)).toEqual(expected); } }
    finally { clock.mockRestore(); random.mockRestore(); }
    expect(digest(expected)).toHaveLength(64);
  });
});

function longCaptured() {
  const c = researchCapturedFixture(); const end = Date.parse(c.bars["1m"]!.at(-1)!.barCloseTime);
  c.bars["1m"] = Array.from({ length: 360 }, (_, i) => ({ symbol: "BTC/USDT", interval: "1m" as const,
    open: String(100 + i), close: String(101 + i), high: String(102 + i), low: String(99 + i), volume: "10",
    barOpenTime: new Date(end - (360 - i) * 60000).toISOString(), barCloseTime: new Date(end - (359 - i) * 60000).toISOString() }));
  return c;
}
const what = (out: ReturnType<typeof evaluate>) => out.questionEvaluations.find(q => q.questionId === "Q_WHAT_HAPPENING")!;
describe("current owned full-input dependency controls (historical31 meaning, freshly executed)", () => {
  for (const long of [false, true]) it.each(["quote-values", "quote-time", "book-values", "book-unavailable", "trade-values", "trade-unavailable"])(
    `preserves WHAT under %s in ${long ? "reconstruction" : "fallback"} while retaining changed input`, kind => {
      const original = long ? longCaptured() : researchCapturedFixture(); const changed = copy(original);
      const quote = changed.observations.find(o => o.kind === "quote_l1")!;
      const book = changed.observations.find(o => o.kind === "order_book_snapshot")!;
      const trades = changed.observations.find(o => o.kind === "market_trades_snapshot")!;
      if (kind === "quote-values") { changed.quote.bid = "1"; changed.quote.ask = "9"; changed.quote.last = "5"; quote.payload = { ...changed.quote }; delete quote.payload.symbol; }
      if (kind === "quote-time") { changed.quote.timestamp = "2026-09-26T11:00:00.000Z"; quote.provenance.eventTimeUtc = changed.quote.timestamp; quote.payload.timestamp = changed.quote.timestamp; }
      if (kind === "book-values") { book.payload.bestBid = 1; book.payload.bestAsk = 1000; }
      if (kind === "trade-values") { trades.payload.latestPrice = 1; trades.payload.latestAmount = 100000; trades.payload.latestDirection = "sell"; }
      if (kind === "book-unavailable" || kind === "trade-unavailable") { const o = kind === "book-unavailable" ? book : trades; o.health = "UNAVAILABLE"; o.payload = { unavailable: true, reason: "SOURCE_UNAVAILABLE" }; }
      const before = evaluate(researchPureFixture({ captured: original })); const after = evaluate(researchPureFixture({ captured: changed }));
      expect(what(after)).toEqual(what(before)); expect(after.reconstruction.contentDigest).toBe(before.reconstruction.contentDigest);
      expect(after.inputs.fullPacketDigest).not.toBe(before.inputs.fullPacketDigest); expect(after.inputs.capturedDigest).not.toBe(before.inputs.capturedDigest);
    });
  it.each(["15m", "1h", "1d"] as const)("retains %s full-lane provenance while its direction does not alter WHAT", interval => {
    const original = researchCapturedFixture(); const changed = copy(original);
    for (const b of changed.bars[interval]!) Object.assign(b, { open: "100", close: "100", high: "102", low: "99" });
    const before = evaluate(researchPureFixture({ captured: original })); const after = evaluate(researchPureFixture({ captured: changed }));
    expect(what(after)).toEqual(what(before)); expect(after.inputs.capturedDigest).not.toBe(before.inputs.capturedDigest);
  });
  it("actual primary flat history changes the reconstruction answer", () => {
    const c = longCaptured(); for (const b of c.bars["1m"]!) Object.assign(b, { open: "100", close: "101", high: "102", low: "99" });
    expect(what(evaluate(researchPureFixture({ captured: longCaptured() }))).answerSummary).toBe("TRENDING");
    expect(what(evaluate(researchPureFixture({ captured: c }))).answerSummary).toBe("RANGING");
  });
  it("4h is required because its opposite direction changes the actual fallback answer", () => {
    const c = researchCapturedFixture(); c.bars["4h"]!.forEach((b, i) => Object.assign(b, { open: String(200 - i * 3), high: String(202 - i * 3), low: String(198 - i * 3), close: String(199 - i * 3) }));
    expect(what(evaluate(researchPureFixture({ captured: c }))).answerSummary).toBe("CHOPPING");
  });
  it("keeps evidence SUPPORTED but PARTIAL/UNCLEAR computation explicitly unresolved", () => {
    const c = researchCapturedFixture(); c.bars["4h"]!.forEach(b => Object.assign(b, { open: "100", close: "100", high: "102", low: "99" }));
    const out = evaluate(researchPureFixture({ captured: c })); expect(what(out)).toMatchObject({ status: "PARTIAL", answerSummary: "UNCLEAR" });
    expect(out.receipt.status).toBe("SUFFICIENT"); expect(out.artifact.claims.find(c => c.marketQuestionId === "Q_WHAT_HAPPENING")!.claimState).toBe("SUPPORTED");
    expect(out.disposition).toBe("COMPLETED_UNRESOLVED");
  });
  it("binds interior full bars even when their summary and WHAT answer are unchanged", () => {
    const c = longCaptured(); const original = researchPureFixture({ captured: c }); c.bars["1m"]![100]!.close = "200.5";
    const changed = researchPureFixture({ captured: c });
    expect(changed.packet.normalized.observations[0]).toEqual(original.packet.normalized.observations[0]);
    const a = evaluate(original); const b = evaluate(changed); expect(what(a)).toEqual(what(b));
    expect(a.inputs.fullPacketDigest).not.toBe(b.inputs.fullPacketDigest);
    expect(a.lanes[0]!.fullLaneDigest).not.toBe(b.lanes[0]!.fullLaneDigest);
  });
  it("retains volume as a full reconstruction dependency", () => {
    const original = longCaptured(); const changed = copy(original); changed.bars["1m"]!.at(-1)!.volume = "1000";
    expect(evaluate(researchPureFixture({ captured: changed })).reconstruction.contentDigest).not.toBe(evaluate(researchPureFixture({ captured: original })).reconstruction.contentDigest);
  });
  it("retains provenance absence for optional non-supporting timeframes", () => {
    const c = researchCapturedFixture(); for (const interval of ["15m", "1h", "1d"] as const) delete c.bars[interval];
    c.observations = c.observations.filter(o => !o.interval || ["1m", "4h"].includes(o.interval));
    const a = evaluate(researchPureFixture()); const b = evaluate(researchPureFixture({ captured: c }));
    expect(what(a).answerSummary).toBe(what(b).answerSummary); expect(what(a).evidenceProvenanceIds).not.toEqual(what(b).evidenceProvenanceIds);
  });
  it("honors an explicitly configured staleness bound without choosing a default", () => {
    const f = researchPureFixture(); f.profileDefinition.requirements[1]!.maxStalenessMs = 0 as unknown as null;
    f.profile = captureProfileDefinition(f.profileDefinition); f.assignment = buildResearchAssignment(f.config, f.profile, { kind: "SERVICE", id: RESEARCH_SERVICE_ACTOR }, f.assignment.assignedAt);
    expect(evaluate(f).receipt.status).toBe("INSUFFICIENT");
  });
});
