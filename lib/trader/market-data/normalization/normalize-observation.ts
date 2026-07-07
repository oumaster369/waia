import type { Bar, BarInterval, Quote } from "@/lib/trader/intelligence/types";
import {
  OBSERVATION_SCHEMA_VERSION,
  type NormalizedObservation,
  type SourceProvenanceRef,
} from "@/lib/trader/market-data/observation-types";
import { scoreObservationReliability } from "@/lib/trader/market-data/reliability/provider-health";
import { classifySessionPhaseUtc } from "@/lib/trader/market-data/session/session-phase-classifier";

export function buildProvenanceRef(input: {
  providerId: SourceProvenanceRef["providerId"];
  venue: string;
  feedKind: string;
  symbol: string;
  eventTimeUtc: string;
  ingestTimeUtc?: string;
}): SourceProvenanceRef {
  return {
    providerId: input.providerId,
    venue: input.venue,
    feedKind: input.feedKind,
    symbol: input.symbol,
    eventTimeUtc: input.eventTimeUtc,
    ingestTimeUtc: input.ingestTimeUtc ?? new Date().toISOString(),
  };
}

export function normalizeOhlcvBarsObservation(input: {
  bars: readonly Bar[];
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
}): NormalizedObservation {
  const latest = input.bars[input.bars.length - 1];
  const first = input.bars[0];
  const eventTime = latest?.barCloseTime ?? input.evaluatedAt;
  const freshnessMs = Math.max(0, Date.parse(input.evaluatedAt) - Date.parse(eventTime));
  const reliability = scoreObservationReliability({ freshnessMs });

  let openCloseDeltaPct: number | undefined;
  if (first && latest) {
    const open = Number(first.open);
    const close = Number(latest.close);
    if (Number.isFinite(open) && Number.isFinite(close) && open > 0) {
      openCloseDeltaPct = ((close - open) / open) * 100;
    }
  }

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "ohlcv_bar",
    interval: latest?.interval,
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      barCount: input.bars.length,
      latestClose: latest?.close,
      latestBarCloseTime: latest?.barCloseTime,
      openCloseDeltaPct,
    },
  };
}

export function normalizeQuoteObservation(input: {
  quote: Quote;
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
}): NormalizedObservation {
  const freshnessMs = Math.max(
    0,
    Date.parse(input.evaluatedAt) - Date.parse(input.quote.timestamp),
  );
  const reliability = scoreObservationReliability({ freshnessMs });

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "quote_l1",
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      bid: input.quote.bid,
      ask: input.quote.ask,
      last: input.quote.last,
      timestamp: input.quote.timestamp,
    },
  };
}

export function normalizeCrossExchangeConfirmation(input: {
  symbol: string;
  primaryLast: string;
  confirmLast: string;
  confirmVenue: string;
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
}): NormalizedObservation {
  const primary = Number(input.primaryLast);
  const confirm = Number(input.confirmLast);
  const dislocationBps =
    primary > 0 ? (Math.abs(confirm - primary) / primary) * 10_000 : Number.POSITIVE_INFINITY;

  const baseConfidence = dislocationBps <= 25 ? 0.95 : dislocationBps <= 75 ? 0.7 : 0.4;
  const reliability = scoreObservationReliability({
    freshnessMs: 0,
    baseConfidence,
  });

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "cross_exchange_confirmation",
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs: 0,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      symbol: input.symbol,
      primaryLast: input.primaryLast,
      confirmLast: input.confirmLast,
      confirmVenue: input.confirmVenue,
      dislocationBps,
      aligned: dislocationBps <= 25,
    },
  };
}

export function normalizeFearGreedObservation(input: {
  value: number;
  classification: string;
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
  eventTimeUtc: string;
}): NormalizedObservation {
  const freshnessMs = Math.max(0, Date.parse(input.evaluatedAt) - Date.parse(input.eventTimeUtc));
  const reliability = scoreObservationReliability({ freshnessMs });

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "fear_greed_index",
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      value: input.value,
      classification: input.classification,
    },
  };
}

export function normalizeGlobalMarketObservation(input: {
  btcDominance: number;
  marketCapUsd: number;
  provenance: SourceProvenanceRef;
  latencyMs: number;
  evaluatedAt: string;
  eventTimeUtc: string;
}): NormalizedObservation {
  const freshnessMs = Math.max(0, Date.parse(input.evaluatedAt) - Date.parse(input.eventTimeUtc));
  const reliability = scoreObservationReliability({ freshnessMs, baseConfidence: 0.85 });

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "global_market_stats",
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs,
    latencyMs: input.latencyMs,
    confidence: reliability.confidence,
    payload: {
      btcDominance: input.btcDominance,
      marketCapUsd: input.marketCapUsd,
    },
  };
}

export function normalizeUnavailableObservation(input: {
  kind: NormalizedObservation["kind"];
  provenance: SourceProvenanceRef;
  evaluatedAt: string;
  reason: string;
  interval?: BarInterval;
}): NormalizedObservation {
  const reliability = scoreObservationReliability({ freshnessMs: 0, unavailable: true });

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: input.kind,
    interval: input.interval,
    sessionPhase: classifySessionPhaseUtc(input.evaluatedAt),
    provenance: input.provenance,
    health: reliability.health,
    freshnessMs: 0,
    latencyMs: 0,
    confidence: reliability.confidence,
    payload: {
      unavailable: true,
      reason: input.reason,
    },
  };
}
