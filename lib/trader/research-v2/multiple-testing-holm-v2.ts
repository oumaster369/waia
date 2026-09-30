import { StrategyEvolutionResearchError } from "@/lib/trader/research-v2/research-v2-guards";
import {
  RESEARCH_V2_MULTIPLE_TESTING_METHOD,
  RESEARCH_V2_SIGNIFICANCE_ALPHA,
  assertResearchV2SampleFloor,
  type ResearchV2SampleFloorInput,
} from "@/lib/trader/research-v2/research-v2-sample-floor";

export const RESEARCH_HYPOTHESIS_FAMILY_V2_SCHEMA =
  "waia.trader.research_hypothesis_family.v2" as const;

export type ResearchHypothesisTrialCountsV2 = ResearchV2SampleFloorInput;

export type ResearchHypothesisFamilyTrialV2 = Readonly<{
  trialIndex: number;
  rawPValue: string;
  adjustedPValue: string;
  holmRank: number;
}>;

export type ResearchHypothesisFamilyV2 = Readonly<{
  schemaVersion: typeof RESEARCH_HYPOTHESIS_FAMILY_V2_SCHEMA;
  method: typeof RESEARCH_V2_MULTIPLE_TESTING_METHOD;
  familySize: number;
  alpha: "0.05";
  trials: readonly ResearchHypothesisFamilyTrialV2[];
}>;

function assertProbability(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new StrategyEvolutionResearchError("QUALIFICATION_P_VALUE_INVALID");
  }
}

export function formatResearchPValue(value: number): string {
  assertProbability(value);
  return value.toFixed(8);
}

/** Two-sided exact binomial sign test at p = 0.5. `successes` are strictly positive trades. */
export function exactTwoSidedSignTestPValue(successes: number, trials: number): number {
  if (
    !Number.isSafeInteger(successes) ||
    !Number.isSafeInteger(trials) ||
    trials < 1 ||
    successes < 0 ||
    successes > trials
  ) {
    throw new StrategyEvolutionResearchError("QUALIFICATION_P_VALUE_INVALID");
  }
  const logPmf: number[] = [];
  for (let k = 0; k <= trials; k += 1) {
    let logChoose = 0;
    for (let i = 0; i < k; i += 1) {
      logChoose += Math.log(trials - i) - Math.log(i + 1);
    }
    logPmf.push(logChoose - trials * Math.LN2);
  }
  const observed = logPmf[successes]!;
  let p = 0;
  for (const logTerm of logPmf) {
    if (logTerm <= observed + 1e-12) {
      p += Math.exp(logTerm);
    }
  }
  return Math.min(1, p);
}

/**
 * Holm step-down adjusted p-values. Rank ties keep the original index order.
 * Adjusted values are monotone in rank and capped at 1.
 */
export function applyHolmAdjustment(pValues: readonly number[]): number[] {
  if (pValues.length < 1) {
    throw new StrategyEvolutionResearchError("QUALIFICATION_FAMILY_EMPTY");
  }
  for (const value of pValues) {
    assertProbability(value);
  }
  const familySize = pValues.length;
  const order = pValues
    .map((p, index) => ({ p, index }))
    .sort((left, right) => left.p - right.p || left.index - right.index);
  const adjusted = new Array<number>(familySize);
  let running = 0;
  for (let rank = 0; rank < familySize; rank += 1) {
    const step = Math.min(1, order[rank]!.p * (familySize - rank));
    running = Math.max(running, step);
    adjusted[order[rank]!.index] = Math.min(1, running);
  }
  return adjusted;
}

export function evaluateHypothesisFamilyV2(
  trials: readonly ResearchHypothesisTrialCountsV2[],
): ResearchHypothesisFamilyV2 {
  if (trials.length < 1) {
    throw new StrategyEvolutionResearchError("QUALIFICATION_FAMILY_EMPTY");
  }
  for (const trial of trials) {
    assertResearchV2SampleFloor(trial);
  }
  const raw = trials.map((trial) =>
    exactTwoSidedSignTestPValue(trial.positiveTradeCount, trial.nonZeroTradeCount),
  );
  const adjusted = applyHolmAdjustment(raw);
  const rankByIndex = new Map<number, number>();
  raw
    .map((p, index) => ({ p, index }))
    .sort((left, right) => left.p - right.p || left.index - right.index)
    .forEach((entry, rank) => {
      rankByIndex.set(entry.index, rank);
    });
  return Object.freeze({
    schemaVersion: RESEARCH_HYPOTHESIS_FAMILY_V2_SCHEMA,
    method: RESEARCH_V2_MULTIPLE_TESTING_METHOD,
    familySize: trials.length,
    alpha: "0.05" as const,
    trials: Object.freeze(
      raw.map((p, index) =>
        Object.freeze({
          trialIndex: index,
          rawPValue: formatResearchPValue(p),
          adjustedPValue: formatResearchPValue(adjusted[index]!),
          holmRank: rankByIndex.get(index) ?? index,
        }),
      ),
    ),
  });
}

export function holmAdjustedPRejectsNull(adjustedPValue: string): boolean {
  const parsed = Number(adjustedPValue);
  assertProbability(parsed);
  return parsed <= RESEARCH_V2_SIGNIFICANCE_ALPHA;
}
