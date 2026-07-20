import type {
  NormalizedObservationKind,
  ProviderHealth,
} from "@/lib/trader/market-data/observation-types";

export type FreshnessThreshold = {
  degradedMs: number;
  staleMs: number;
  baseConfidence?: number;
};

const HEALTHY_CONFIDENCE = 1;
const DEGRADED_CONFIDENCE = 0.6;
const STALE_CONFIDENCE = 0.35;
const UNAVAILABLE_CONFIDENCE = 0;

export const FRESHNESS_THRESHOLDS_BY_KIND: Record<NormalizedObservationKind, FreshnessThreshold> = {
  ohlcv_bar: { degradedMs: 120_000, staleMs: 300_000 },
  quote_l1: { degradedMs: 60_000, staleMs: 120_000 },
  order_book_snapshot: { degradedMs: 60_000, staleMs: 120_000 },
  market_trades_snapshot: { degradedMs: 60_000, staleMs: 120_000 },
  cross_exchange_confirmation: {
    degradedMs: 60_000,
    staleMs: 120_000,
    baseConfidence: 0.95,
  },
  fear_greed_index: {
    degradedMs: 86_400_000,
    staleMs: 172_800_000,
    baseConfidence: 0.85,
  },
  global_market_stats: {
    degradedMs: 300_000,
    staleMs: 900_000,
    baseConfidence: 0.85,
  },
  macro_series: {
    degradedMs: 3_600_000,
    staleMs: 86_400_000,
    baseConfidence: 0.9,
  },
  macro_calendar_event: {
    degradedMs: 3_600_000,
    staleMs: 86_400_000,
    baseConfidence: 0.85,
  },
  macro_probability: {
    degradedMs: 3_600_000,
    staleMs: 86_400_000,
    baseConfidence: 0.8,
  },
  news_headline: {
    degradedMs: 1_800_000,
    staleMs: 7_200_000,
    baseConfidence: 0.75,
  },
  news_event_cluster: {
    degradedMs: 1_800_000,
    staleMs: 7_200_000,
    baseConfidence: 0.75,
  },
  exchange_announcement: {
    degradedMs: 3_600_000,
    staleMs: 86_400_000,
    baseConfidence: 0.85,
  },
  protocol_release: {
    degradedMs: 3_600_000,
    staleMs: 86_400_000,
    baseConfidence: 0.85,
  },
  blockchain_network_stats: {
    degradedMs: 300_000,
    staleMs: 900_000,
    baseConfidence: 0.85,
  },
  regulatory_filing: {
    degradedMs: 86_400_000,
    staleMs: 604_800_000,
    baseConfidence: 0.8,
  },
  mempool_stats: {
    degradedMs: 300_000,
    staleMs: 900_000,
    baseConfidence: 0.85,
  },
};

export function getFreshnessThreshold(kind: NormalizedObservationKind): FreshnessThreshold {
  return FRESHNESS_THRESHOLDS_BY_KIND[kind];
}

export function scoreObservationReliabilityWithPolicy(input: {
  kind: NormalizedObservationKind;
  freshnessMs: number;
  baseConfidence?: number;
  unavailable?: boolean;
}): { health: ProviderHealth; confidence: number } {
  if (input.unavailable) {
    return { health: "UNAVAILABLE", confidence: UNAVAILABLE_CONFIDENCE };
  }

  const threshold = getFreshnessThreshold(input.kind);
  const base = input.baseConfidence ?? threshold.baseConfidence ?? HEALTHY_CONFIDENCE;

  if (input.freshnessMs > threshold.staleMs) {
    return {
      health: "STALE",
      confidence: Math.min(base, STALE_CONFIDENCE),
    };
  }

  if (input.freshnessMs > threshold.degradedMs) {
    return {
      health: "DEGRADED",
      confidence: Math.min(base, DEGRADED_CONFIDENCE),
    };
  }

  return {
    health: "HEALTHY",
    confidence: base,
  };
}
