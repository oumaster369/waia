import {
  MIN_FEE_THRESHOLD,
  PERFORMANCE_FEE_RATE,
  type FeeComputationArtifact,
  type FeeComputationInput,
} from "@/lib/trader/billing/fee-computation.types";
import type { ReportingPeriodRecordView } from "@/lib/trader/billing/reporting-period.types";
import {
  addDecimal,
  compareDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
} from "@/lib/trader/risk/numeric";

function maxDecimal(a: string, b: string): string {
  return compareDecimal(a, b) >= 0
    ? formatDecimal(parseDecimal(a))
    : formatDecimal(parseDecimal(b));
}

export function sortClosedReportingPeriodsChronologically(
  periods: ReportingPeriodRecordView[],
): ReportingPeriodRecordView[] {
  return [...periods].sort((left, right) => {
    const leftEnd = left.periodEnd?.getTime() ?? 0;
    const rightEnd = right.periodEnd?.getTime() ?? 0;
    if (leftEnd !== rightEnd) {
      return leftEnd - rightEnd;
    }

    const leftStart = left.periodStart.getTime();
    const rightStart = right.periodStart.getTime();
    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }

    return left.id.localeCompare(right.id);
  });
}

export function selectClosedPeriodsUpToTarget(
  periods: ReportingPeriodRecordView[],
  targetPeriodId: string,
): ReportingPeriodRecordView[] {
  const sorted = sortClosedReportingPeriodsChronologically(periods);
  const selected: ReportingPeriodRecordView[] = [];

  for (const period of sorted) {
    selected.push(period);
    if (period.id === targetPeriodId) {
      return selected;
    }
  }

  return selected;
}

export function foldCumulativeRealizedStrategyProfit(periods: ReportingPeriodRecordView[]): string {
  return periods.reduce((sum, period) => addDecimal(sum, period.realizedPnl!), "0");
}

export function computeFeeComputation(input: FeeComputationInput): FeeComputationArtifact {
  const feeRate = input.feeRate ?? PERFORMANCE_FEE_RATE;
  const minFeeThreshold = input.minFeeThreshold ?? MIN_FEE_THRESHOLD;

  const newProfitAboveHwm =
    compareDecimal(input.cumulativeRealizedStrategyProfit, input.previousHighWaterMark) > 0
      ? formatDecimal(
          parseDecimal(input.cumulativeRealizedStrategyProfit) -
            parseDecimal(input.previousHighWaterMark),
        )
      : "0";

  const performanceFee = multiplyDecimal(newProfitAboveHwm, feeRate);
  const proposedNewHighWaterMark = maxDecimal(
    input.previousHighWaterMark,
    input.cumulativeRealizedStrategyProfit,
  );
  const billable = compareDecimal(performanceFee, minFeeThreshold) >= 0;

  return {
    periodId: input.periodId,
    organizationId: input.organizationId,
    exchangeAccountId: input.exchangeAccountId,
    periodRealizedStrategyProfit: input.periodRealizedStrategyProfit,
    cumulativeRealizedStrategyProfit: input.cumulativeRealizedStrategyProfit,
    previousHighWaterMark: input.previousHighWaterMark,
    newProfitAboveHwm,
    feeRate,
    performanceFee,
    proposedNewHighWaterMark,
    billable,
    unrealizedPnl: input.unrealizedPnl,
    realizedFillFinality: input.realizedFillFinality,
    computedAt: input.computedAt ?? new Date(),
  };
}
