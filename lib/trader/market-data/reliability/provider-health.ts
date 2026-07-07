import type {
  NormalizedObservation,
  ProviderHealth,
} from "@/lib/trader/market-data/observation-types";

const STALE_FRESHNESS_MS = 120_000;
const DEGRADED_FRESHNESS_MS = 60_000;
const HEALTHY_CONFIDENCE = 1;
const DEGRADED_CONFIDENCE = 0.6;
const STALE_CONFIDENCE = 0.35;
const UNAVAILABLE_CONFIDENCE = 0;

export function scoreObservationReliability(input: {
  freshnessMs: number;
  baseConfidence?: number;
  unavailable?: boolean;
}): { health: ProviderHealth; confidence: number } {
  if (input.unavailable) {
    return { health: "UNAVAILABLE", confidence: UNAVAILABLE_CONFIDENCE };
  }

  const base = input.baseConfidence ?? HEALTHY_CONFIDENCE;

  if (input.freshnessMs > STALE_FRESHNESS_MS) {
    return {
      health: "STALE",
      confidence: Math.min(base, STALE_CONFIDENCE),
    };
  }

  if (input.freshnessMs > DEGRADED_FRESHNESS_MS) {
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

export function aggregateProviderHealth(observations: readonly NormalizedObservation[]): {
  health: ProviderHealth;
  confidence: number;
} {
  if (observations.length === 0) {
    return { health: "UNAVAILABLE", confidence: 0 };
  }

  const rank: Record<ProviderHealth, number> = {
    HEALTHY: 0,
    DEGRADED: 1,
    STALE: 2,
    UNAVAILABLE: 3,
  };

  let worst: ProviderHealth = "HEALTHY";
  let minConfidence = 1;

  for (const observation of observations) {
    if (rank[observation.health] > rank[worst]) {
      worst = observation.health;
    }
    minConfidence = Math.min(minConfidence, observation.confidence);
  }

  return { health: worst, confidence: minConfidence };
}
