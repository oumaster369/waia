import type { ResearchExperimentSpecV1 } from "@/lib/trader/research/research-experiment-contract-v1";
import { resolveFhvCanonicalPartitionInterval } from "@/lib/trader/market-data/fhv-partition-boundaries";

const INVALID_RANGE = "RESEARCH_DEVELOPMENT_EVALUATION_RANGE_INVALID";
const MINUTE_MS = 60_000;

type EvaluationRange = Readonly<{
  firstOpenMs: number;
  lastCloseMs: number;
  barCount: number;
}>;

function requireRange(value: EvaluationRange, startMs: number, endMs: number): EvaluationRange {
  if (!value || !Number.isSafeInteger(value.firstOpenMs) || !Number.isSafeInteger(value.lastCloseMs) ||
      !Number.isSafeInteger(value.barCount) || value.barCount <= 0 ||
      value.firstOpenMs % MINUTE_MS !== 0 || value.lastCloseMs % MINUTE_MS !== 0) {
    throw new Error(INVALID_RANGE);
  }
  const durationMs = value.barCount * MINUTE_MS;
  if (!Number.isSafeInteger(durationMs) || value.firstOpenMs >= value.lastCloseMs ||
      value.firstOpenMs < startMs || value.lastCloseMs > endMs ||
      value.lastCloseMs - value.firstOpenMs !== durationMs) {
    throw new Error(INVALID_RANGE);
  }
  return value;
}

/** Validate declared DEVELOPMENT evaluation identities only; this establishes no source authority. */
export function assertResearchDevelopmentEvaluationRangesV1(spec: ResearchExperimentSpecV1): void {
  try {
    if (spec.universe.interval !== "1m") throw new Error(INVALID_RANGE);
    const development = resolveFhvCanonicalPartitionInterval("development");
    const startMs = Date.parse(development.startUtc);
    const endMs = Date.parse(development.endUtc);
    if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs >= endMs) {
      throw new Error(INVALID_RANGE);
    }

    const validation = requireRange(spec.partitions.validation, startMs, endMs);
    const windows = spec.partitions.walkForward;
    if (!Array.isArray(windows) || windows.length === 0) throw new Error(INVALID_RANGE);
    let previousLastCloseMs = validation.firstOpenMs;
    for (const window of windows) {
      const checked = requireRange(window, startMs, endMs);
      if (checked.firstOpenMs < validation.firstOpenMs || checked.lastCloseMs > validation.lastCloseMs ||
          checked.firstOpenMs < previousLastCloseMs) {
        throw new Error(INVALID_RANGE);
      }
      previousLastCloseMs = checked.lastCloseMs;
    }
  } catch {
    throw new Error(INVALID_RANGE);
  }
}
