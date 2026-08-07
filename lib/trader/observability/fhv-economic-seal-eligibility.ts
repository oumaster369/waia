import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { TERMINAL_ORDER_STATES } from "@/lib/trader/execution/order-state-machine";

/**
 * Economic-seal eligibility (ADR-0025, OPTION_E section 1).
 *
 * Terminality is one input, never the rule. An order is eligible only when it is economically
 * complete AND reconciled AND its history is durably sealed in the ledger under a committed
 * epoch whose source frontier proves every event at or below the boundary was consumed.
 */

export type FhvEconomicSealIneligibilityReason =
  | "NOT_TERMINAL_STATE"
  | "OPEN_EXECUTION"
  | "PENDING_FILL_PROGRESS"
  | "PENDING_CANCELLATION_OUTCOME"
  | "RECONCILIATION_REQUIRED_STATE"
  | "UNRESOLVED_PARTIAL_FILL"
  | "PENDING_EXCHANGE_ACKNOWLEDGEMENT"
  | "PENDING_TERMINAL_CORRECTION"
  | "QUANTITY_RECONCILE_MISMATCH"
  | "AVG_FILL_PRICE_MISSING"
  | "LEDGER_NOT_DURABLE"
  | "EPOCH_NOT_COMMITTED"
  | "SOURCE_FRONTIER_NOT_PROVEN"
  | "RECONCILIATION_NOT_CLEAN";

export type FhvSealCandidateOrder = Readonly<{
  orderId: string;
  state: string;
  quantity: string;
  filledQuantity: string;
  avgFillPrice: string | null;
  /** Sum of fill quantities observed for this order in the ledger-bound history. */
  fillQuantitySum: string;
  fillCount: number;
  /** True when the order still has any unacknowledged or in-flight execution intent. */
  hasPendingExecutionIntent: boolean;
}>;

export type FhvSealBoundaryProof = Readonly<{
  /** The epoch commit that owns this boundary is fully committed. */
  epochCommitted: boolean;
  /** Every event at or below the candidate boundary has been consumed. */
  sourceFrontierProven: boolean;
  /** Reality reconciliation produced no outstanding discrepancy. */
  reconciliationClean: boolean;
  /** The ledger segment holding this history is durable and verified. */
  ledgerDurable: boolean;
}>;

export type FhvEconomicSealEligibility =
  | Readonly<{ orderId: string; eligible: true }>
  | Readonly<{
      orderId: string;
      eligible: false;
      reason: FhvEconomicSealIneligibilityReason;
    }>;

function decimalsEqual(a: string, b: string): boolean {
  // Economic decimals are compared as strings after trailing-zero normalization.
  // They must never round-trip through Number.
  const normalize = (value: string): string => {
    if (!value.includes(".")) {
      return value.replace(/^(-?)0+(?=\d)/, "$1");
    }
    const trimmed = value.replace(/0+$/, "").replace(/\.$/, "");
    return trimmed.replace(/^(-?)0+(?=\d)/, "$1");
  };
  return normalize(a) === normalize(b);
}

/**
 * Boundary-level prerequisites. When these fail, nothing at this boundary may be sealed.
 */
export function evaluateFhvSealBoundary(
  proof: FhvSealBoundaryProof,
): FhvEconomicSealIneligibilityReason | null {
  if (!proof.ledgerDurable) {
    return "LEDGER_NOT_DURABLE";
  }
  if (!proof.epochCommitted) {
    return "EPOCH_NOT_COMMITTED";
  }
  if (!proof.sourceFrontierProven) {
    return "SOURCE_FRONTIER_NOT_PROVEN";
  }
  if (!proof.reconciliationClean) {
    return "RECONCILIATION_NOT_CLEAN";
  }
  return null;
}

/** Per-order economic completeness. Terminality alone never satisfies this. */
export function evaluateFhvEconomicSealEligibility(
  order: FhvSealCandidateOrder,
  proof: FhvSealBoundaryProof,
): FhvEconomicSealEligibility {
  const boundaryFailure = evaluateFhvSealBoundary(proof);
  if (boundaryFailure) {
    return { orderId: order.orderId, eligible: false, reason: boundaryFailure };
  }

  if (order.state === "RECONCILIATION_REQUIRED") {
    return { orderId: order.orderId, eligible: false, reason: "RECONCILIATION_REQUIRED_STATE" };
  }
  if (order.state === "CANCEL_REQUESTED") {
    return { orderId: order.orderId, eligible: false, reason: "PENDING_CANCELLATION_OUTCOME" };
  }
  if (order.state === "PARTIALLY_FILLED") {
    return { orderId: order.orderId, eligible: false, reason: "UNRESOLVED_PARTIAL_FILL" };
  }
  if (!TERMINAL_ORDER_STATES.includes(order.state as never)) {
    return { orderId: order.orderId, eligible: false, reason: "NOT_TERMINAL_STATE" };
  }
  if (order.hasPendingExecutionIntent) {
    return { orderId: order.orderId, eligible: false, reason: "PENDING_EXCHANGE_ACKNOWLEDGEMENT" };
  }

  // Economic completeness: recorded fills must reconcile exactly with the order aggregate.
  if (!decimalsEqual(order.fillQuantitySum, order.filledQuantity)) {
    return { orderId: order.orderId, eligible: false, reason: "QUANTITY_RECONCILE_MISMATCH" };
  }
  if (order.state === "FILLED" && !decimalsEqual(order.filledQuantity, order.quantity)) {
    return { orderId: order.orderId, eligible: false, reason: "PENDING_FILL_PROGRESS" };
  }
  if (order.fillCount > 0 && order.avgFillPrice == null) {
    return { orderId: order.orderId, eligible: false, reason: "AVG_FILL_PRICE_MISSING" };
  }
  // A terminal order that never executed (REJECTED / EXPIRED / FAILED with no fills) is complete.
  if (order.fillCount === 0 && order.state === "FILLED") {
    return { orderId: order.orderId, eligible: false, reason: "QUANTITY_RECONCILE_MISMATCH" };
  }

  return { orderId: order.orderId, eligible: true };
}
