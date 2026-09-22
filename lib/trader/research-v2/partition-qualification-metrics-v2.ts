import { addDecimal, formatDecimal, minDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import {
  assertResearchDiscoveryFitnessV2,
  requireResearchV2Decimal,
  requireResearchV2DigestHex,
  requireResearchV2NonEmpty,
  StrategyEvolutionResearchError,
} from "@/lib/trader/research-v2/research-v2-guards";
import {
  queryBlindHoldoutAsIterativeFitnessV2,
  type QualificationEvaluationV2,
  type QualificationPartitionV2,
} from "@/lib/trader/research-v2/qualification-records-v2";

const MAX_PARTITION_WINDOWS = 32;

export type PartitionWindowMetricV2 = Readonly<{
  windowId: string;
  partition: QualificationPartitionV2 | "BLIND_HOLDOUT";
  netEconomicResult: string;
  maxDrawdown: string;
  tailEventCount: number;
  closedTradeCount: number;
  incumbentComparisonDigestHex: string;
}>;

function sameEvaluation(
  left: QualificationEvaluationV2,
  right: QualificationEvaluationV2,
): boolean {
  return (
    parseDecimal(left.netEconomicResult) === parseDecimal(right.netEconomicResult) &&
    parseDecimal(left.maxDrawdown) === parseDecimal(right.maxDrawdown) &&
    left.tailEventCount === right.tailEventCount &&
    left.sampleSize === right.sampleSize &&
    left.incumbentComparisonDigestHex === right.incumbentComparisonDigestHex
  );
}

/** Aggregate already recorded partition windows. Does not read closed-trade outcomes. */
export function deriveQualificationEvaluationFromPartitionWindowsV2(
  windows: readonly PartitionWindowMetricV2[],
): QualificationEvaluationV2 {
  if (!Array.isArray(windows) || windows.length < 1 || windows.length > MAX_PARTITION_WINDOWS) {
    throw new StrategyEvolutionResearchError("QUALIFICATION_PARTITION_WINDOWS_INVALID");
  }
  const partition = windows[0]?.partition;
  if (partition === "BLIND_HOLDOUT") {
    queryBlindHoldoutAsIterativeFitnessV2();
  }
  if (partition !== "DEVELOPMENT" && partition !== "WALK_FORWARD") {
    throw new StrategyEvolutionResearchError("QUALIFICATION_PARTITION_WINDOWS_INVALID");
  }
  const seen = new Set<string>();
  let net = "0";
  let drawdown = windows[0]?.maxDrawdown ?? "0";
  let tails = 0;
  let sample = 0;
  const incumbent = windows[0]?.incumbentComparisonDigestHex ?? "";
  for (const window of windows) {
    assertResearchDiscoveryFitnessV2(window, "partition window metric");
    requireResearchV2NonEmpty(window.windowId, "QUALIFICATION_PARTITION_WINDOWS_INVALID");
    if (seen.has(window.windowId) || window.partition !== partition) {
      throw new StrategyEvolutionResearchError("QUALIFICATION_PARTITION_WINDOWS_INVALID");
    }
    seen.add(window.windowId);
    requireResearchV2Decimal(window.netEconomicResult, "QUALIFICATION_PARTITION_WINDOWS_INVALID");
    requireResearchV2Decimal(window.maxDrawdown, "QUALIFICATION_PARTITION_WINDOWS_INVALID");
    requireResearchV2DigestHex(
      window.incumbentComparisonDigestHex,
      "QUALIFICATION_PARTITION_WINDOWS_INVALID",
    );
    if (window.incumbentComparisonDigestHex !== incumbent) {
      throw new StrategyEvolutionResearchError("QUALIFICATION_PARTITION_WINDOWS_INVALID");
    }
    if (
      !Number.isSafeInteger(window.tailEventCount) ||
      window.tailEventCount < 0 ||
      !Number.isSafeInteger(window.closedTradeCount) ||
      window.closedTradeCount < 0
    ) {
      throw new StrategyEvolutionResearchError("QUALIFICATION_PARTITION_WINDOWS_INVALID");
    }
    net = addDecimal(net, window.netEconomicResult);
    drawdown = minDecimal(drawdown, window.maxDrawdown);
    tails += window.tailEventCount;
    sample += window.closedTradeCount;
  }
  if (sample < 1) {
    throw new StrategyEvolutionResearchError("QUALIFICATION_PARTITION_WINDOWS_INVALID");
  }
  return Object.freeze({
    netEconomicResult: formatDecimal(parseDecimal(net)),
    maxDrawdown: formatDecimal(parseDecimal(drawdown)),
    tailEventCount: tails,
    sampleSize: sample,
    incumbentComparisonDigestHex: incumbent,
  });
}

export function assertPartitionEvaluationMatchesWindowsV2(
  supplied: QualificationEvaluationV2 | undefined,
  derived: QualificationEvaluationV2,
): void {
  if (supplied === undefined) return;
  assertResearchDiscoveryFitnessV2(supplied, "supplied partition evaluation");
  if (!sameEvaluation(supplied, derived)) {
    throw new StrategyEvolutionResearchError(
      "QUALIFICATION_PARTITION_METRICS_MISMATCH",
      "Supplied evaluation does not match recorded partition windows",
    );
  }
}
