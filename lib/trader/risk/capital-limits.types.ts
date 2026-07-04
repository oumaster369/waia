import type { PlaceOrderInput } from "@/lib/trader/connectors/types";

import type { RiskDecision } from "@/lib/trader/risk/types";

/** Capital limit thresholds (injection-only in v0; aligns with DEE-239 field names). */
export type CapitalLimitsConfig = {
  maxPositionPerSymbol: string;
  maxDailyLoss: string;
  maxDrawdown: string;
  maxOpenOrders: number;
  maxQuoteExposure: string;
  maxRiskPerTradePct: string;
  maxPortfolioRiskPct: string;
  maxConcurrentPositions: number;
};

export type PositionSnapshot = {
  symbol: string;
  quantity: string;
};

/** Synthetic account snapshot for capital evaluation (mock/replayed in Phase 3). */
export type AccountRiskState = {
  positions: readonly PositionSnapshot[];
  openOrderCount: number;
  dailyPnl: string;
  drawdown: string;
  quoteExposureByCurrency: Readonly<Record<string, string>>;
  /** M2 portfolio extensions (populated when portfolio adapter is wired). */
  availableBalanceUsdt?: string;
  equityUsdt?: string;
  openRiskUsdt?: string;
  openPositionCount?: number;
  /** Projected risk-at-stop for the order under evaluation. */
  projectedOrderRiskUsdt?: string;
};

export type CapitalLimitsEvaluationInput = {
  order: PlaceOrderInput;
  referencePrice: string;
  accountState: AccountRiskState;
  /** M2: stop distance for projected order risk (from StopDistanceProvider). */
  stopDistanceUsdt?: string;
};

export type CapitalLimitsEvaluatorDeps = {
  nowMs: () => number;
};

export type CapitalLimitsEvaluationResult = RiskDecision;
