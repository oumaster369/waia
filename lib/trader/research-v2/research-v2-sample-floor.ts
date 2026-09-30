import { StrategyEvolutionResearchError } from "@/lib/trader/research-v2/research-v2-guards";

/**
 * Pre-registered research-v2 sample floor (DEE-1152 scientific hygiene).
 *
 * A partition or hypothesis trial below either floor is not a scientific result.
 * Callers fail closed with `QUALIFICATION_SAMPLE_BELOW_MINIMUM` and must not
 * record QUALIFIED or REJECTED.
 *
 * Sample floors now follow `docs/ai-trader/specs/strategy-admission-v1.md`:
 * continuous IS uses 30 trades (100 if intraday) and validation uses 15 (50 if
 * intraday); event IS uses 30 events and 15 dates, validation 20 events and 10
 * dates. A short sample is `insufficient_data`, not a pass. The constants below
 * remain the continuous non-intraday IS floor used by older guards.
 *
 * Holm's procedure (`RESEARCH_V2_MULTIPLE_TESTING_METHOD`) is the default
 * multiple-testing correction. Family size is the number of hypotheses in the
 * run, not the number of partitions of one hypothesis.
 */
export const RESEARCH_V2_MIN_CLOSED_TRADES = 30 as const;
export const RESEARCH_V2_MIN_DISTINCT_UTC_DAYS = 10 as const;
export const RESEARCH_V2_SIGNIFICANCE_ALPHA = 0.05 as const;
export const RESEARCH_V2_MULTIPLE_TESTING_METHOD = "holm" as const;

export type ResearchV2SampleFloorInput = Readonly<{
  sampleSize: number;
  distinctDayCount: number;
  positiveTradeCount: number;
  nonZeroTradeCount: number;
}>;

export function assertResearchV2SampleFloor(input: ResearchV2SampleFloorInput): void {
  const counts = [
    input.sampleSize,
    input.distinctDayCount,
    input.positiveTradeCount,
    input.nonZeroTradeCount,
  ];
  if (counts.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new StrategyEvolutionResearchError("QUALIFICATION_EVALUATION_INVALID");
  }
  if (input.positiveTradeCount > input.nonZeroTradeCount) {
    throw new StrategyEvolutionResearchError("QUALIFICATION_EVALUATION_INVALID");
  }
  if (input.nonZeroTradeCount > input.sampleSize) {
    throw new StrategyEvolutionResearchError("QUALIFICATION_EVALUATION_INVALID");
  }
  if (
    input.sampleSize < RESEARCH_V2_MIN_CLOSED_TRADES ||
    input.nonZeroTradeCount < RESEARCH_V2_MIN_CLOSED_TRADES ||
    input.distinctDayCount < RESEARCH_V2_MIN_DISTINCT_UTC_DAYS
  ) {
    throw new StrategyEvolutionResearchError(
      "QUALIFICATION_SAMPLE_BELOW_MINIMUM",
      `sample requires at least ${RESEARCH_V2_MIN_CLOSED_TRADES} closed trades, ` +
        `${RESEARCH_V2_MIN_CLOSED_TRADES} non-zero trades, and ` +
        `${RESEARCH_V2_MIN_DISTINCT_UTC_DAYS} distinct UTC days`,
    );
  }
}
