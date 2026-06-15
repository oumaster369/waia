import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import type { OrderExecutionMode, OrderState } from "@/lib/trader/execution/types";
import type { TraderAuditInput } from "@/lib/trader/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export const reconciliationClassificationEnum = [
  "IN_SYNC",
  "VENUE_ACKED",
  "FILL_PROGRESS",
  "VENUE_TERMINALIZED",
  "NOT_FOUND_AT_VENUE",
  "UNKNOWN_POSITION",
  "AMBIGUOUS_STALE",
  "TERMINAL_DRIFT",
  "SKIPPED_CONFLICT",
] as const;

export type ReconciliationClassification = (typeof reconciliationClassificationEnum)[number];

export type ReconcileTarget =
  | { kind: "open"; executionMode: "mock" | "paper" }
  | { kind: "order"; orderId: string };

export type OrderReconciliationOutcome = {
  orderId?: string;
  clientOrderId: string;
  classification: ReconciliationClassification;
  fromState?: OrderState;
  toState?: OrderState;
  recordedFills: string[];
  markedReconciliationRequired: boolean;
  detail?: string;
};

export type ReconciliationReport = {
  organizationId: string;
  runStartedAt: Date;
  outcomes: OrderReconciliationOutcome[];
  counts: Record<ReconciliationClassification, number>;
};

export type ReconciliationServiceDeps = {
  orderRepository: OrderRepository;
  connectorForMode: (executionMode: OrderExecutionMode) => ExchangeConnector;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
  nowMs: () => number;
};

export type ReconciliationService = {
  reconcile(context: OrgContext, target: ReconcileTarget): Promise<ReconciliationReport>;
};

export const POST_DISPATCH_RECONCILABLE_STATES: readonly OrderState[] = [
  "SENT_TO_EXCHANGE",
  "ACCEPTED",
  "PARTIALLY_FILLED",
  "CANCEL_REQUESTED",
  "RECONCILIATION_REQUIRED",
] as const;

export function isPostDispatchReconcilable(state: OrderState): boolean {
  return (POST_DISPATCH_RECONCILABLE_STATES as readonly string[]).includes(state);
}

export function isPreDispatchState(state: OrderState): boolean {
  return state === "CREATED" || state === "RISK_APPROVED";
}

export function emptyReconciliationCounts(): Record<ReconciliationClassification, number> {
  return {
    IN_SYNC: 0,
    VENUE_ACKED: 0,
    FILL_PROGRESS: 0,
    VENUE_TERMINALIZED: 0,
    NOT_FOUND_AT_VENUE: 0,
    UNKNOWN_POSITION: 0,
    AMBIGUOUS_STALE: 0,
    TERMINAL_DRIFT: 0,
    SKIPPED_CONFLICT: 0,
  };
}
