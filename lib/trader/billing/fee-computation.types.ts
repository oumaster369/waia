/** Performance fee rate (30%) applied to profit above HWM. */
export const PERFORMANCE_FEE_RATE = "0.30" as const;

/** Minimum performance fee (USD) required for billable=true. */
export const MIN_FEE_THRESHOLD = "10.00" as const;

export type FeeComputationInput = {
  periodId: string;
  organizationId: string;
  exchangeAccountId: string;
  periodRealizedStrategyProfit: string;
  cumulativeRealizedStrategyProfit: string;
  previousHighWaterMark: string;
  unrealizedPnl: string | null;
  realizedFillFinality: boolean;
  feeRate?: string;
  minFeeThreshold?: string;
  computedAt?: Date;
};

/** Pure computation artifact — not persisted by S4. */
export type FeeComputationArtifact = {
  periodId: string;
  organizationId: string;
  exchangeAccountId: string;
  periodRealizedStrategyProfit: string;
  cumulativeRealizedStrategyProfit: string;
  previousHighWaterMark: string;
  newProfitAboveHwm: string;
  feeRate: string;
  performanceFee: string;
  proposedNewHighWaterMark: string;
  billable: boolean;
  unrealizedPnl: string | null;
  realizedFillFinality: boolean;
  computedAt: Date;
};
