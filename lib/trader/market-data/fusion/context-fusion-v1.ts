import {
  FUSED_CONTEXT_SCHEMA_VERSION,
  type FusedMarketContext,
  type NormalizedObservation,
} from "@/lib/trader/market-data/observation-types";
import { aggregateProviderHealth } from "@/lib/trader/market-data/reliability/provider-health";
import { computeAsianRangeCorridorMetadata } from "@/lib/trader/market-data/session/asian-range-corridor";
import { classifySessionPhaseUtc } from "@/lib/trader/market-data/session/session-phase-classifier";
import { filterValidObservations } from "@/lib/trader/market-data/validation/validate-observation";
import type { CrossVenueTriangulation } from "@/lib/trader/intelligence/market-understanding.types";
import type { BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";
import type { FuseContextV0Input } from "@/lib/trader/market-data/fusion/context-fusion-v0";

export type FuseContextV1Input = FuseContextV0Input & {
  orderBookSnapshot?: NormalizedObservation;
  marketTradesSnapshot?: NormalizedObservation;
  macroEvidence?: readonly NormalizedObservation[];
  newsEvidence?: readonly NormalizedObservation[];
  blockchainEvidence?: readonly NormalizedObservation[];
  regulatoryEvidence?: readonly NormalizedObservation[];
  protocolEvidence?: readonly NormalizedObservation[];
};

function appendOptionalObservations(
  target: NormalizedObservation[],
  observations?: readonly NormalizedObservation[],
): void {
  if (!observations) {
    return;
  }
  target.push(...filterValidObservations(observations));
}

export function fuseContextV1(input: FuseContextV1Input): FusedMarketContext {
  const sessionPhase = classifySessionPhaseUtc(input.fusedAtUtc);

  const flatObservations: NormalizedObservation[] = [];
  for (const observations of Object.values(input.mtfBars)) {
    if (observations) {
      flatObservations.push(...filterValidObservations(observations));
    }
  }

  for (const optional of [
    input.primaryQuote,
    input.orderBookSnapshot,
    input.marketTradesSnapshot,
    input.crossExchangeConfirmation,
    input.fearGreed,
    input.globalMarket,
  ]) {
    if (optional) {
      flatObservations.push(...filterValidObservations([optional]));
    }
  }

  appendOptionalObservations(flatObservations, input.macroEvidence);
  appendOptionalObservations(flatObservations, input.newsEvidence);
  appendOptionalObservations(flatObservations, input.blockchainEvidence);
  appendOptionalObservations(flatObservations, input.regulatoryEvidence);
  appendOptionalObservations(flatObservations, input.protocolEvidence);

  const healthObservations = flatObservations.filter(
    (observation) => observation.health !== "UNAVAILABLE",
  );
  const aggregate = aggregateProviderHealth(
    healthObservations.length > 0 ? healthObservations : flatObservations,
  );
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
    orderBookSnapshot: input.orderBookSnapshot,
    marketTradesSnapshot: input.marketTradesSnapshot,
    crossExchangeConfirmation: input.crossExchangeConfirmation,
    crossVenueTriangulation: input.crossVenueTriangulation,
    fearGreed: input.fearGreed,
    globalMarket: input.globalMarket,
    macroEvidence: input.macroEvidence ? filterValidObservations(input.macroEvidence) : undefined,
    newsEvidence: input.newsEvidence ? filterValidObservations(input.newsEvidence) : undefined,
    blockchainEvidence: input.blockchainEvidence
      ? filterValidObservations(input.blockchainEvidence)
      : undefined,
    regulatoryEvidence: input.regulatoryEvidence
      ? filterValidObservations(input.regulatoryEvidence)
      : undefined,
    protocolEvidence: input.protocolEvidence
      ? filterValidObservations(input.protocolEvidence)
      : undefined,
    asianRangeCorridor,
    aggregateHealth: aggregate.health,
    aggregateConfidence: aggregate.confidence,
    provenance,
    degradationReasons: input.degradationReasons ?? [],
  };
}
