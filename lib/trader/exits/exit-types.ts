export const EXIT_PLAN_SCHEMA_VERSION = "waia.trader.exit-plan.v1";

export type TrailingPhase = "INACTIVE" | "ARMED" | "TRIGGERED";

export type StopLevel = {
  kind: "STOP_LOSS";
  price: string;
  distanceUsdt: string;
  atrMultiple: string;
  computedAt: string;
};

export type TakeProfitLevel = {
  kind: "TAKE_PROFIT";
  price: string;
  distanceUsdt: string;
  atrMultiple: string;
  computedAt: string;
};

export type TrailingState = {
  schemaVersion: typeof EXIT_PLAN_SCHEMA_VERSION;
  phase: TrailingPhase;
  entryPrice: string;
  activationPrice: string;
  trailingDistanceUsdt: string;
  maxFavorableExcursionUsdt: string;
  peakPrice: string;
  stopPrice: string | null;
  lastUpdatedAt: string;
};

export type ExitPlan = {
  schemaVersion: typeof EXIT_PLAN_SCHEMA_VERSION;
  positionLotId: string;
  symbol: string;
  entryPrice: string;
  atrPeriod: number;
  atrUsdt: string;
  stopLoss: StopLevel;
  takeProfit: TakeProfitLevel;
  trailing: TrailingState;
  planBuiltAt: string;
};

/** Snapshot attached to GuardianReasonRecord.slTpLevels when ATR/plan is valid. */
export type SlTpLevelsSnapshot = {
  stopLossPrice: string;
  takeProfitPrice: string;
  trailingStopPrice: string | null;
  atrUsdt: string;
  trailingPhase: TrailingPhase;
};

export type ExitRunConfig = {
  enabled: boolean;
  atrPeriod: number;
  stopLossAtrMultiple: string;
  takeProfitAtrMultiple: string;
  trailingActivationAtrMultiple: string;
  trailingDistanceAtrMultiple: string;
};

export const DEFAULT_EXIT_RUN_CONFIG: ExitRunConfig = {
  enabled: true,
  atrPeriod: 14,
  stopLossAtrMultiple: "2",
  takeProfitAtrMultiple: "3",
  trailingActivationAtrMultiple: "1.5",
  trailingDistanceAtrMultiple: "1",
};
