import type { PlaceOrderInput } from "@/lib/trader/connectors/types";

import type { RiskDecision } from "@/lib/trader/risk/types";

/** Capital limit thresholds (injection-only in v0; aligns with DEE-239 field names). */
export type CapitalLimitsConfig = {
  maxPositionPerSymbol: string;
  maxDailyLoss: string;
  maxDrawdown: string;
  maxOpenOrders: number;
  maxQuoteExposure: string;
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
};

export type CapitalLimitsEvaluationInput = {
  order: PlaceOrderInput;
  referencePrice: string;
  accountState: AccountRiskState;
};

export type CapitalLimitsEvaluatorDeps = {
  nowMs: () => number;
};

export type CapitalLimitsEvaluationResult = RiskDecision;
