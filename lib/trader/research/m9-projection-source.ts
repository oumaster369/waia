import type { StreamingEvidenceReader } from "@/lib/trader/backtest/streaming-evidence";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";

export type M9ProjectionSourceInput = {
  cycleResults?: readonly PaperCycleResult[];
  projectionReader?: StreamingEvidenceReader;
};

export function assertM9ProjectionSource(input: M9ProjectionSourceInput): void {
  const hasArray = (input.cycleResults?.length ?? 0) > 0;
  const hasReader = Boolean(input.projectionReader);
  if (!hasArray && !hasReader) {
    throw new Error("[m9-projection-source] cycleResults or projectionReader is required");
  }
  if (hasArray && hasReader) {
    throw new Error("[m9-projection-source] provide cycleResults or projectionReader, not both");
  }
}

export function countM9InputCycles(input: M9ProjectionSourceInput): number {
  if (input.projectionReader) {
    return input.projectionReader.projectionCount();
  }
  return input.cycleResults?.length ?? 0;
}

export function* iterateM9Cycles(input: M9ProjectionSourceInput): Generator<PaperCycleResult> {
  if (input.projectionReader) {
    yield* input.projectionReader.iteratePaperCycleResults();
    return;
  }
  for (const cycle of input.cycleResults ?? []) {
    yield cycle;
  }
}
