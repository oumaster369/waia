import { IllegalOrderTransitionError, type OrderState } from "@/lib/trader/execution/types";

/** Legal transitions per Master Spec v2 §14 (DEE-247). */
export const ORDER_TRANSITIONS: Record<OrderState, readonly OrderState[]> = {
  CREATED: ["RISK_APPROVED", "REJECTED", "FAILED"],
  RISK_APPROVED: ["SENT_TO_EXCHANGE", "REJECTED", "FAILED"],
  SENT_TO_EXCHANGE: ["ACCEPTED", "REJECTED", "FAILED", "RECONCILIATION_REQUIRED"],
  ACCEPTED: [
    "PARTIALLY_FILLED",
    "FILLED",
    "CANCEL_REQUESTED",
    "EXPIRED",
    "FAILED",
    "RECONCILIATION_REQUIRED",
  ],
  PARTIALLY_FILLED: ["FILLED", "CANCEL_REQUESTED", "EXPIRED", "FAILED", "RECONCILIATION_REQUIRED"],
  CANCEL_REQUESTED: ["CANCELLED", "FILLED", "FAILED", "RECONCILIATION_REQUIRED"],
  RECONCILIATION_REQUIRED: [
    "ACCEPTED",
    "PARTIALLY_FILLED",
    "FILLED",
    "CANCELLED",
    "REJECTED",
    "EXPIRED",
    "FAILED",
  ],
  FILLED: [],
  CANCELLED: [],
  REJECTED: [],
  EXPIRED: [],
  FAILED: [],
};

export const TERMINAL_ORDER_STATES: readonly OrderState[] = [
  "FILLED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
  "FAILED",
] as const;

export function isLegalTransition(from: OrderState, to: OrderState): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderState, to: OrderState): void {
  if (!isLegalTransition(from, to)) {
    throw new IllegalOrderTransitionError(from, to);
  }
}

export function isTerminal(state: OrderState): boolean {
  return ORDER_TRANSITIONS[state].length === 0;
}
