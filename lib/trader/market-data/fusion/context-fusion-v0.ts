import {
  FUSED_CONTEXT_SCHEMA_VERSION,
  type FusedMarketContext,
  type NormalizedObservation,
} from "@/lib/trader/market-data/observation-types";
import { aggregateProviderHealth } from "@/lib/trader/market-data/reliability/provider-health";
import { computeAsianRangeCorridorMetadata } from "@/lib/trader/market-data/session/asian-range-corridor";
import { classifySessionPhaseUtc } from "@/lib/trader/market-data/session/session-phase-classifier";
import { filterValidObservations } from "@/lib/trader/market-data/validation/validate-observation";
import type { BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";

export type FuseContextV0Input = {
  instrumentId: InstrumentId;
  fusedAtUtc: string;
  mtfBars: Partial<Record<BarInterval, NormalizedObservation[]>>;
  primaryQuote?: NormalizedObservation;
  crossExchangeConfirmation?: NormalizedObservation;
  fearGreed?: NormalizedObservation;
  globalMarket?: NormalizedObservation;
  degradationReasons?: readonly string[];
};

export function fuseContextV0(input: FuseContextV0Input): FusedMarketContext {
  const sessionPhase = classifySessionPhaseUtc(input.fusedAtUtc);

  const flatObservations: NormalizedObservation[] = [];
  for (const observations of Object.values(input.mtfBars)) {
    if (observations) {
      flatObservations.push(...filterValidObservations(observations));
    }
  }

  for (const optional of [
    input.primaryQuote,
    input.crossExchangeConfirmation,
    input.fearGreed,
    input.globalMarket,
  ]) {
    if (optional) {
      const validated = filterValidObservations([optional]);
      flatObservations.push(...validated);
    }
  }

  const aggregate = aggregateProviderHealth(flatObservations);
  const provenance = flatObservations.map((observation) => observation.provenance);

  const mtfBars: FusedMarketContext["mtfBars"] = {};
  for (const [interval, observations] of Object.entries(input.mtfBars)) {
    if (observations) {
      mtfBars[interval as BarInterval] = filterValidObservations(observations);
    }
  }

  const asianRangeCorridor = computeAsianRangeCorridorMetadata({
    sessionPhase,
    mtfBars,
  });

  return {
    schemaVersion: FUSED_CONTEXT_SCHEMA_VERSION,
    fusedAtUtc: input.fusedAtUtc,
    instrumentId: input.instrumentId,
    sessionPhase,
    mtfBars,
    primaryQuote: input.primaryQuote,
    crossExchangeConfirmation: input.crossExchangeConfirmation,
    fearGreed: input.fearGreed,
    globalMarket: input.globalMarket,
    asianRangeCorridor,
    aggregateHealth: aggregate.health,
    aggregateConfidence: aggregate.confidence,
    provenance,
    degradationReasons: input.degradationReasons ?? [],
  };
}
