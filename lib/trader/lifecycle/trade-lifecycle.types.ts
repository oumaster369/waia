import type { Regime } from "@/lib/trader/intelligence/types";

export const positionSideValues = ["LONG", "SHORT"] as const;
export type PositionSide = (typeof positionSideValues)[number];

export const instrumentKindValues = ["SPOT", "PERP", "FUTURE"] as const;
export type InstrumentKind = (typeof instrumentKindValues)[number];

export const positionLotStateValues = ["OPEN", "CLOSED"] as const;
export type PositionLotState = (typeof positionLotStateValues)[number];

export const tradeStateValues = ["OPEN", "CLOSED", "FORCED_FLAT"] as const;
export type TradeState = (typeof tradeStateValues)[number];

export const tradeLegKindValues = ["OPEN_FILL", "CLOSE_FILL", "FORCED_FLAT"] as const;
export type TradeLegKind = (typeof tradeLegKindValues)[number];

export const lifecycleEventPhaseValues = [
  "SIGNAL_ACCEPTED",
  "ORDER_SUBMITTED",
  "ORDER_FILLED",
  "TRADE_OPENED",
  "TRADE_CLOSED",
  "FORCED_FLAT",
  "GUARDIAN_EVALUATED",
  "GUARDIAN_EXIT_INTENT",
] as const;
export type LifecycleEventPhase = (typeof lifecycleEventPhaseValues)[number];

export const lifecycleEntityTypeValues = [
  "TRADE",
  "POSITION_LOT",
  "ORDER",
  "FILL",
  "STRATEGY_SIGNAL",
] as const;
export type LifecycleEntityType = (typeof lifecycleEntityTypeValues)[number];

/** Live evolving exposure (M3 Guardian monitor target). */
export type PositionLotRow = {
  id: string;
  organizationId: string;
  symbol: string;
  venue: string;
  accountKey: string;
  positionSide: PositionSide;
  instrumentKind: InstrumentKind;
  strategySignalId: string;
  state: PositionLotState;
  openQty: string;
  remainingQty: string;
  avgCost: string;
  openedAt: Date;
  closedAt: Date | null;
  tradeId: string;
  hedgeGroupId: string | null;
  targetLotId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Round-trip knowledge record — terminal rows are immutable (frozenAt set). */
export type TradeRow = {
  id: string;
  organizationId: string;
  symbol: string;
  venue: string;
  accountKey: string;
  positionSide: PositionSide;
  instrumentKind: InstrumentKind;
  strategySignalId: string;
  strategyId: string;
  strategyVersion: string;
  state: TradeState;
  semanticsVersion: string;
  openedAt: Date;
  closedAt: Date | null;
  realizedPnl: string;
  markedPnl: string;
  hypothesisId: string | null;
  patternId: string | null;
  riskDecisionId: string;
  allocationDecisionId: string | null;
  reasoningSessionId: string | null;
  signalConfidence: string | null;
  openingRegime: Regime | null;
  openingMsvId: string | null;
  openingFeatureSetId: string | null;
  closingMsvId: string | null;
  closingFeatureSetId: string | null;
  closingRegime: Regime | null;
  frozenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Append-only execution leg. */
export type TradeLegRow = {
  id: string;
  organizationId: string;
  tradeId: string;
  positionLotId: string;
  kind: TradeLegKind;
  orderId: string;
  fillId: string | null;
  syntheticId: string | null;
  quantity: string;
  price: string;
  fee: string;
  executedAt: Date;
  legPnl: string;
  createdAt: Date;
};

/** Append-only lifecycle trace. */
export type LifecycleEventRow = {
  id: string;
  organizationId: string;
  entityType: LifecycleEntityType;
  entityId: string;
  phase: LifecycleEventPhase;
  payload: string | null;
  occurredAt: Date;
  researchRunId: string | null;
  createdAt: Date;
};

export type TradeLineageAtOpen = {
  strategyId: string;
  strategyVersion: string;
  strategySignalId: string;
  riskDecisionId: string;
  allocationDecisionId?: string | null;
  reasoningSessionId?: string | null;
  signalConfidence?: string | null;
  openingRegime?: Regime | null;
  openingMsvId?: string | null;
  openingFeatureSetId?: string | null;
  hypothesisId?: string | null;
  patternId?: string | null;
};

export type TradeClosingWorldState = {
  closingMsvId?: string | null;
  closingFeatureSetId?: string | null;
  closingRegime?: Regime | null;
};

export type PairingKey = {
  organizationId: string;
  symbol: string;
  strategySignalId: string;
  positionSide: PositionSide;
  accountKey: string;
};

export function buildPairingKey(input: {
  organizationId: string;
  symbol: string;
  strategySignalId: string;
  positionSide?: PositionSide;
  accountKey?: string;
}): string {
  const side = input.positionSide ?? "LONG";
  const accountKey = input.accountKey ?? "default";
  return `${input.organizationId}:${input.symbol}:${input.strategySignalId}:${side}:${accountKey}`;
}

export function isTerminalTradeState(state: TradeState): boolean {
  return state === "CLOSED" || state === "FORCED_FLAT";
}
