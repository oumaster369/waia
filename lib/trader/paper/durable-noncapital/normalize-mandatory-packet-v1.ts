import type { GatewayPollResult } from "@/lib/trader/market-data/market-data-gateway";
import { MTF_BAR_INTERVALS, OBSERVATION_SCHEMA_VERSION, type NormalizedObservation } from "@/lib/trader/market-data/observation-types";
import { normalizeOhlcvBarsObservation, normalizeQuoteObservation } from "@/lib/trader/market-data/normalization/normalize-observation";
import { fuseContextV1 } from "@/lib/trader/market-data/fusion/context-fusion-v1";
import { scoreObservationReliabilityWithPolicy } from "@/lib/trader/market-data/reliability/freshness-policy";
import { classifySessionPhaseUtc } from "@/lib/trader/market-data/session/session-phase-classifier";
import { normalizeRecordedNoncapitalInputV2 } from "@/lib/trader/runtime-v2/noncapital-cycle-receipt-v2";
import { compareDecimal, InvalidDecimalError } from "@/lib/trader/risk/numeric";
import { intervalDurationMs } from "@/lib/trader/market-data/mtf/mtf-bar-aggregator";
import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { copy, digest, iso, requireCondition as check, NORMALIZATION_CONTRACT,
  RecordedAnalysisRefusal, type AnalysisSession, type CapturedMandatory, type NormalizedMandatory } from "./recorded-analysis-v1";

function recordedBar(input: Parameters<typeof normalizeRecordedNoncapitalInputV2>[0]) {
  try { return normalizeRecordedNoncapitalInputV2(input); }
  catch { throw new RecordedAnalysisRefusal("INVALID_RECORDED_BAR"); }
}
function compareQuote(left: string, right: string) {
  try { return compareDecimal(left, right); }
  catch (error) { if (error instanceof InvalidDecimalError) throw new RecordedAnalysisRefusal("INVALID_QUOTE_DECIMAL"); throw error; }
}

/** Retain domain fields only. Provider exception strings are deliberately not durable input. */
export function captureMandatoryBundle(bundle: GatewayPollResult, session: AnalysisSession): CapturedMandatory {
  check(bundle.informationAcquisition === null && Object.keys(bundle.crossExchangeObservations ?? {}).length === 0, "OPTIONAL_SOURCE_REFUSED");
  for (const key of ["macroEvidence", "newsEvidence", "blockchainEvidence", "regulatoryEvidence", "protocolEvidence"] as const) {
    check((bundle.fusedContext[key]?.length ?? 0) === 0, "OPTIONAL_SOURCE_REFUSED");
  }
  for (const key of ["crossExchangeConfirmation", "crossVenueTriangulation", "fearGreed", "globalMarket"] as const) {
    check(bundle.fusedContext[key] === undefined, "OPTIONAL_SOURCE_REFUSED");
  }
  const bars: CapturedMandatory["bars"] = {};
  for (const key of Object.keys(bundle.mtfBarsByInterval)) check(MTF_BAR_INTERVALS.includes(key as typeof MTF_BAR_INTERVALS[number]));
  for (const interval of MTF_BAR_INTERVALS) {
    const lane = bundle.mtfBarsByInterval[interval]; if (!lane) continue;
    check(lane.length <= session.maxBarsPerInterval, "BARS_LIMIT_EXCEEDED");
    bars[interval] = lane.map(bar => {
      check(bar.symbol === session.symbol && bar.interval === interval, "SOURCE_SCOPE_CONFLICT");
      return recordedBar({ organizationId: session.organizationId, accountId: session.accountId,
        releaseSha: session.releaseSha, bar }).bar;
    });
  }
  check(digest(bars["1m"]) === digest(bundle.snapshot.bars), "SOURCE_SCOPE_CONFLICT");
  const q = bundle.snapshot.quote; check(q && q.symbol === session.symbol, "SOURCE_SCOPE_CONFLICT");
  const quote = { symbol: q.symbol, bid: q.bid, ask: q.ask, last: q.last, timestamp: q.timestamp };
  const observations = bundle.canonicalPitCandidates.map(o => {
    check(o.provenance.providerId === "htx_spot" && o.provenance.venue === "htx" &&
      o.provenance.symbol === session.symbol && o.provenance.feedKind === o.kind, "SOURCE_SCOPE_CONFLICT");
    check(["ohlcv_bar", "quote_l1", "order_book_snapshot", "market_trades_snapshot"].includes(o.kind), "OPTIONAL_SOURCE_REFUSED");
    const keys = o.health === "UNAVAILABLE" ? [] : o.kind === "ohlcv_bar" ?
      ["barCount", "latestClose", "latestBarCloseTime", "openCloseDeltaPct"] : o.kind === "quote_l1" ?
      ["bid", "ask", "last", "timestamp"] : o.kind === "order_book_snapshot" ?
      ["symbol", "bidLevels", "askLevels", "bestBid", "bestAsk", "eventTimeUtc"] :
      ["symbol", "tradeCount", "latestPrice", "latestAmount", "latestDirection", "eventTimeUtc"];
    const payload = o.health === "UNAVAILABLE" ? { unavailable: true, reason: "SOURCE_UNAVAILABLE" } :
      Object.fromEntries(keys.filter(key => o.payload[key] !== undefined).map(key => [key, o.payload[key]]));
    return copy({ schemaVersion: o.schemaVersion, kind: o.kind, interval: o.interval, sessionPhase: o.sessionPhase,
      provenance: { providerId: o.provenance.providerId, venue: o.provenance.venue, feedKind: o.provenance.feedKind,
        symbol: o.provenance.symbol, eventTimeUtc: o.provenance.eventTimeUtc, ingestTimeUtc: o.provenance.ingestTimeUtc },
      health: o.health, freshnessMs: o.freshnessMs, latencyMs: o.latencyMs, confidence: o.confidence, payload });
  });
  return copy({ bars, quote, observations });
}

export function normalizeMandatory(input: CapturedMandatory, session: AnalysisSession, analysisPitAnchor: string): NormalizedMandatory {
  iso(analysisPitAnchor); const pit = Date.parse(analysisPitAnchor);
  const captured = copy(input);
  const keys = (value: object, allowed: readonly string[]) => check(Object.keys(value).every(k => allowed.includes(k)), "UNKNOWN_INPUT_FIELD");
  keys(captured, ["bars", "quote", "observations"]); keys(captured.bars, MTF_BAR_INTERVALS);
  keys(captured.quote, ["symbol", "bid", "ask", "last", "timestamp"]);
  const bars: CapturedMandatory["bars"] = {}; const excludedOpenBars: NormalizedMandatory["excludedOpenBars"] = [];
  const observations: NormalizedObservation[] = []; const mtf: NormalizedMandatory["fusedContext"]["mtfBars"] = {};
  const identities = new Set<string>();
  for (const o of captured.observations) {
    keys(o, ["schemaVersion", "kind", "interval", "sessionPhase", "provenance", "health", "freshnessMs", "latencyMs", "confidence", "payload"]);
    keys(o.provenance, ["providerId", "venue", "feedKind", "symbol", "eventTimeUtc", "ingestTimeUtc"]);
    const payloadKeys = o.health === "UNAVAILABLE" ? ["unavailable", "reason"] : o.kind === "ohlcv_bar" ?
      ["barCount", "latestClose", "latestBarCloseTime", "openCloseDeltaPct"] : o.kind === "quote_l1" ?
      ["bid", "ask", "last", "timestamp"] : o.kind === "order_book_snapshot" ?
      ["symbol", "bidLevels", "askLevels", "bestBid", "bestAsk", "eventTimeUtc"] :
      ["symbol", "tradeCount", "latestPrice", "latestAmount", "latestDirection", "eventTimeUtc"];
    keys(o.payload, payloadKeys);
    if (o.health === "UNAVAILABLE") check(o.payload.unavailable === true && o.payload.reason === "SOURCE_UNAVAILABLE");
    const key = `${o.kind}:${o.interval ?? ""}`; check(!identities.has(key), "DUPLICATE_SOURCE"); identities.add(key);
    check(o.schemaVersion === OBSERVATION_SCHEMA_VERSION && o.provenance.providerId === "htx_spot" &&
      o.provenance.venue === "htx" && o.provenance.symbol === session.symbol && o.provenance.feedKind === o.kind, "SOURCE_SCOPE_CONFLICT");
    check(["HEALTHY", "DEGRADED", "STALE", "UNAVAILABLE"].includes(o.health));
    check(Number.isFinite(o.latencyMs) && o.latencyMs >= 0 && Number.isFinite(o.confidence) && o.confidence >= 0 && o.confidence <= 1);
    iso(o.provenance.eventTimeUtc); iso(o.provenance.ingestTimeUtc);
    check(Date.parse(o.provenance.ingestTimeUtc) <= pit, "SOURCE_CHRONOLOGY_REFUSED");
    // OHLCV may summarize an open bar; its event is replaced after closed-bar selection.
    if (o.kind !== "ohlcv_bar") check(Date.parse(o.provenance.eventTimeUtc) <= Date.parse(o.provenance.ingestTimeUtc), "SOURCE_CHRONOLOGY_REFUSED");
  }
  for (const interval of MTF_BAR_INTERVALS) {
    const lane = captured.bars[interval] ?? [];
    check(lane.length <= session.maxBarsPerInterval, "BARS_LIMIT_EXCEEDED");
    for (let i = 0; i < lane.length; i++) {
      const bar = lane[i]!;
      keys(bar, ["symbol", "interval", "open", "high", "low", "close", "volume", "barOpenTime", "barCloseTime"]);
      for (const value of [bar.open, bar.high, bar.low, bar.close, bar.volume]) check(typeof value === "string" && /\d/.test(value));
      check(Date.parse(bar.barOpenTime) <= pit && Date.parse(bar.barCloseTime) - Date.parse(bar.barOpenTime) === intervalDurationMs(interval), "BAR_CHRONOLOGY_REFUSED");
      recordedBar({ organizationId: session.organizationId, accountId: session.accountId, releaseSha: session.releaseSha, bar });
      check(bar.symbol === session.symbol && bar.interval === interval, "SOURCE_SCOPE_CONFLICT");
      check(i === 0 || lane[i - 1]!.barCloseTime < bar.barOpenTime || lane[i - 1]!.barCloseTime === bar.barOpenTime, "BAR_ORDER_REFUSED");
    }
    const old = captured.observations.filter(o => o.kind === "ohlcv_bar" && o.interval === interval);
    check(old.length === (lane.length ? 1 : 0), "SOURCE_SET_CONFLICT");
    const retained = lane.filter(bar => Date.parse(bar.barCloseTime) <= pit);
    const excluded = lane.filter(bar => Date.parse(bar.barCloseTime) > pit);
    if (excluded.length) excludedOpenBars.push({ interval, bars: excluded, digest: digest(excluded) });
    if (!retained.length) continue;
    bars[interval] = retained;
    const provenance = { ...old[0]!.provenance, eventTimeUtc: retained.at(-1)!.barCloseTime };
    check(Date.parse(provenance.eventTimeUtc) <= Date.parse(provenance.ingestTimeUtc), "SOURCE_CHRONOLOGY_REFUSED");
    const normalized = normalizeOhlcvBarsObservation({ bars: retained, provenance, evaluatedAt: analysisPitAnchor, latencyMs: old[0]!.latencyMs });
    observations.push(normalized); mtf[interval] = [normalized];
  }
  check((bars["1m"]?.length ?? 0) >= EXPAND_MIN_BARS, "INSUFFICIENT_CLOSED_PRIMARY_BARS");
  const quote = captured.quote; check(quote.symbol === session.symbol, "SOURCE_SCOPE_CONFLICT"); iso(quote.timestamp);
  for (const value of [quote.bid, quote.ask, quote.last]) check(typeof value === "string" && /\d/.test(value) && compareQuote(value, "0") > 0);
  check(compareQuote(quote.bid, quote.ask) <= 0);
  const q = captured.observations.filter(o => o.kind === "quote_l1"); check(q.length === 1, "SOURCE_SET_CONFLICT");
  check(q[0]!.provenance.eventTimeUtc === quote.timestamp && digest(q[0]!.payload) === digest({ bid: quote.bid, ask: quote.ask, last: quote.last, timestamp: quote.timestamp }), "QUOTE_CONTENT_CONFLICT");
  const primaryQuote = normalizeQuoteObservation({ quote, provenance: q[0]!.provenance, latencyMs: q[0]!.latencyMs, evaluatedAt: analysisPitAnchor });
  observations.push(primaryQuote);
  const summaries: Partial<Record<"orderBookSnapshot" | "marketTradesSnapshot", NormalizedObservation>> = {};
  for (const [kind, key] of [["order_book_snapshot", "orderBookSnapshot"], ["market_trades_snapshot", "marketTradesSnapshot"]] as const) {
    const lane = captured.observations.filter(o => o.kind === kind); check(lane.length === 1, "SOURCE_SET_CONFLICT");
    const o = lane[0]!; const p = o.payload;
    if (o.health !== "UNAVAILABLE") {
      check(p.symbol === session.symbol && p.eventTimeUtc === o.provenance.eventTimeUtc, "SOURCE_SCOPE_CONFLICT");
      for (const field of kind === "order_book_snapshot" ? ["bidLevels", "askLevels"] : ["tradeCount"]) check(Number.isSafeInteger(p[field]) && Number(p[field]) >= 0);
      for (const field of kind === "order_book_snapshot" ? ["bestBid", "bestAsk"] : ["latestPrice", "latestAmount"]) {
        if (p[field] !== undefined) check(typeof p[field] === "number" && Number.isFinite(p[field]) && Number(p[field]) >= 0);
      }
      if (p.latestDirection !== undefined) check(p.latestDirection === "buy" || p.latestDirection === "sell");
    }
    const freshnessMs = Math.max(0, pit - Date.parse(o.provenance.eventTimeUtc));
    const reliability = scoreObservationReliabilityWithPolicy({ kind, freshnessMs, unavailable: o.health === "UNAVAILABLE" });
    const normalized = { ...o, ...reliability, freshnessMs, sessionPhase: classifySessionPhaseUtc(analysisPitAnchor) };
    observations.push(normalized); summaries[key] = normalized;
  }
  check(identities.size === Object.values(captured.bars).filter(x => x.length).length + 3, "SOURCE_SET_CONFLICT");
  const fusedContext = fuseContextV1({ instrumentId: session.symbol, fusedAtUtc: analysisPitAnchor, mtfBars: mtf,
    primaryQuote, ...summaries, macroEvidence: [], newsEvidence: [], blockchainEvidence: [], regulatoryEvidence: [], protocolEvidence: [],
    degradationReasons: observations.filter(o => o.health === "UNAVAILABLE").map(o => `${o.kind}_unavailable:SOURCE_UNAVAILABLE`) });
  return copy({ normalization: NORMALIZATION_CONTRACT, captured, bars, excludedOpenBars, quote, observations, fusedContext,
    scheduledBarCloseTime: bars["1m"]!.at(-1)!.barCloseTime });
}
