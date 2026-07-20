import type { FusedMarketContext } from "@/lib/trader/market-data/observation-types";
import type { CrossVenueTriangulation } from "@/lib/trader/intelligence/market-understanding.types";
import type { BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";
import type { NormalizedObservation } from "@/lib/trader/market-data/observation-types";
import { fuseContextV1 } from "@/lib/trader/market-data/fusion/context-fusion-v1";

export type FuseContextV0Input = {
  instrumentId: InstrumentId;
  fusedAtUtc: string;
  mtfBars: Partial<Record<BarInterval, NormalizedObservation[]>>;
  primaryQuote?: NormalizedObservation;
  crossExchangeConfirmation?: NormalizedObservation;
  crossVenueTriangulation?: CrossVenueTriangulation;
  fearGreed?: NormalizedObservation;
  globalMarket?: NormalizedObservation;
  degradationReasons?: readonly string[];
};

export function fuseContextV0(input: FuseContextV0Input): FusedMarketContext {
  return fuseContextV1({
    ...input,
    macroEvidence: [],
    newsEvidence: [],
    blockchainEvidence: [],
    regulatoryEvidence: [],
    protocolEvidence: [],
  });
}
