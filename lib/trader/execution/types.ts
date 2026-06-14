import type { OrderSide, OrderType } from "@/lib/trader/connectors/types";

/** Canonical order lifecycle states (Master Spec v2 §14 / DEE-247). */
export const orderStateEnum = [
  "CREATED",
  "RISK_APPROVED",
  "SENT_TO_EXCHANGE",
  "ACCEPTED",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCEL_REQUESTED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
  "FAILED",
  "RECONCILIATION_REQUIRED",
] as const;

export type OrderState = (typeof orderStateEnum)[number];

/** Safety / PnL-attribution posture — orthogonal to venue (DEE-247 challenge pass). */
export const orderExecutionModeEnum = ["mock", "paper", "live"] as const;

export type OrderExecutionMode = (typeof orderExecutionModeEnum)[number];

export type { OrderSide, OrderType };

/** Append-only order event kinds (persisted in trader_order_events.event_type). */
export const orderEventTypeEnum = ["transition", "reconciliation", "fill_recorded"] as const;

export type OrderEventType = (typeof orderEventTypeEnum)[number];

export class IllegalOrderTransitionError extends Error {
  readonly fromState: OrderState;
  readonly toState: OrderState;

  constructor(fromState: OrderState, toState: OrderState) {
    super(`Illegal order transition: ${fromState} -> ${toState}`);
    this.name = "IllegalOrderTransitionError";
    this.fromState = fromState;
    this.toState = toState;
  }
}
