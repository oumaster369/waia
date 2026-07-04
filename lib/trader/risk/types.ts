import type { OrderSide, OrderType } from "@/lib/trader/connectors/types";

import type { RiskReasonCode } from "@/lib/trader/risk/reason-codes";

/** Risk decision outcomes aligned with Master Spec §13. */
export type RiskDecisionOutcome = "APPROVE" | "RESIZE" | "REJECT" | "CLOSE_ONLY" | "STOP_ACCOUNT";

export type RiskCheckName =
  | "allowlist"
  | "notional"
  | "rate"
  | "collar"
  | "position"
  | "dailyLoss"
  | "drawdown"
  | "openOrders"
  | "quoteExposure"
  | "concurrentPositions"
  | "portfolioRisk"
  | "availableBalance"
  | "stopDistance";

export type RiskSnapshot = {
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  requestedQuantity: string;
  effectivePrice?: string;
  computedNotional?: string;
  checksApplied: RiskCheckName[];
};

export type RiskResizeHint = {
  quantity: string;
  notional: string;
};

export type RiskDecision = {
  outcome: RiskDecisionOutcome;
  reasonCodes: RiskReasonCode[];
  snapshot: RiskSnapshot;
  resize?: RiskResizeHint;
  evaluatedAt: string;
};
