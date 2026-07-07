import {
  OBSERVATION_SCHEMA_VERSION,
  type NormalizedObservation,
} from "@/lib/trader/market-data/observation-types";
import { isRegisteredMarketDataProvider } from "@/lib/trader/market-data/provider-registry";

export type ObservationValidationResult =
  | { valid: true; observation: NormalizedObservation }
  | { valid: false; reason: string };

export function validateObservation(
  observation: NormalizedObservation,
): ObservationValidationResult {
  if (observation.schemaVersion !== OBSERVATION_SCHEMA_VERSION) {
    return { valid: false, reason: "invalid schema version" };
  }

  if (!isRegisteredMarketDataProvider(observation.provenance.providerId)) {
    return { valid: false, reason: "unknown provider id" };
  }

  if (!observation.provenance.eventTimeUtc || !observation.provenance.ingestTimeUtc) {
    return { valid: false, reason: "missing provenance timestamps" };
  }

  if (observation.confidence < 0 || observation.confidence > 1) {
    return { valid: false, reason: "confidence out of range" };
  }

  if (observation.freshnessMs < 0 || observation.latencyMs < 0) {
    return { valid: false, reason: "negative freshness or latency" };
  }

  return { valid: true, observation };
}

export function filterValidObservations(
  observations: readonly NormalizedObservation[],
): NormalizedObservation[] {
  const valid: NormalizedObservation[] = [];
  for (const observation of observations) {
    const result = validateObservation(observation);
    if (result.valid) {
      valid.push(result.observation);
    }
  }
  return valid;
}
