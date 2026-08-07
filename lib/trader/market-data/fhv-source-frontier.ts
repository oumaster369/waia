import type { FhvOfficialDatasetCursorV2 } from "@/lib/trader/market-data/fhv-official-dataset-cursor";
import { computeFhvOfficialDatasetCursorDigest } from "@/lib/trader/market-data/fhv-official-dataset-cursor";

export type FhvSourceFrontier = Readonly<{
  globalEventSequence: number;
  emittedCycleCount: number;
  warmupEventCount: number;
  sourceExhausted: boolean;
  terminalCursorDigest: string;
  lastBarCloseTime: string;
}>;

export function buildFhvSourceFrontier(input: {
  globalEventSequence: number;
  emittedCycleCount: number;
  warmupEventCount: number;
  sourceExhausted: boolean;
  cursor: FhvOfficialDatasetCursorV2;
  lastBarCloseTime: string;
}): FhvSourceFrontier {
  return {
    globalEventSequence: input.globalEventSequence,
    emittedCycleCount: input.emittedCycleCount,
    warmupEventCount: input.warmupEventCount,
    sourceExhausted: input.sourceExhausted,
    terminalCursorDigest: computeFhvOfficialDatasetCursorDigest(input.cursor),
    lastBarCloseTime: input.lastBarCloseTime,
  };
}
