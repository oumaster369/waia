import { computeFeeComputation } from "@/lib/trader/billing/fee-computation";
import type { FeeComputationArtifact } from "@/lib/trader/billing/fee-computation.types";

export function previewClosedPeriodFee(input: {
  periodId: string;
  organizationId: string;
  exchangeAccountId: string;
  periodRealizedStrategyProfit: string;
  cumulativeRealizedStrategyProfit: string;
  previousHighWaterMark: string;
}): { artifact: FeeComputationArtifact; label: string } {
  const artifact = computeFeeComputation({
    ...input,
    unrealizedPnl: null,
    realizedFillFinality: false,
    computedAt: new Date(0),
  });
  const label = artifact.billable
    ? `preliminary calculation, not an invoice: ${artifact.performanceFee}`
    : `Calculated ${artifact.performanceFee}; invoice not created, below threshold`;
  return { artifact, label };
}
