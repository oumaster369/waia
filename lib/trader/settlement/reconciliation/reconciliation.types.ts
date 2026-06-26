import {
  settlementReconciliationResolutionTypeEnum,
  settlementReconciliationCaseStatusEnum,
  auditActorTypeEnum,
  settlementApplicationSourceEnum,
} from "@/db/core-enums";
import type { SettlementRecordView } from "@/lib/trader/settlement/settlement.types";
import type { ReconciliationEventPayload } from "@/lib/trader/settlement/reconciliation/reconciliation.event-payloads";

export const RECONCILIATION_EVENT_SCHEMA_VERSION =
  "waia.trader.settlement-reconciliation-event.v1" as const;
export type ReconciliationEventSchemaVersion = typeof RECONCILIATION_EVENT_SCHEMA_VERSION;

export const RECONCILIATION_EVIDENCE_SNAPSHOT_SCHEMA_VERSION =
  "waia.trader.reconciliation-evidence.v1" as const;
export type ReconciliationEvidenceSnapshotSchemaVersion =
  typeof RECONCILIATION_EVIDENCE_SNAPSHOT_SCHEMA_VERSION;

export const reconciliationCaseStatuses = settlementReconciliationCaseStatusEnum;
export type ReconciliationCaseStatus = (typeof reconciliationCaseStatuses)[number];

export const reconciliationResolutionTypes = settlementReconciliationResolutionTypeEnum;
export type ReconciliationResolutionType = (typeof reconciliationResolutionTypes)[number];

export const settlementApplicationSources = settlementApplicationSourceEnum;
export type SettlementApplicationSource = (typeof settlementApplicationSources)[number];

/** Inline value or future content-addressed artifact reference. */
export type EvidenceValue<T> =
  | { kind: "inline"; value: T }
  | { kind: "reference"; ref: string; contentHash?: string };

export type ReconciliationEvidenceSnapshot = {
  schemaVersion: ReconciliationEvidenceSnapshotSchemaVersion;
  settlement: {
    id: string;
    outcome: SettlementRecordView["outcome"];
    exceptionReason: string | null;
    valuedAmount: string | null;
    valuationCurrency: string | null;
    settlementNetwork: string | null;
    settlementTxHash: string | null;
    onChainAmount: string | null;
    asset: string | null;
    exchangeAccountId: string;
    paymentId: string;
  };
  payment: EvidenceValue<{
    paymentId: string;
    settlementNetwork: string | null;
    settlementAsset: string | null;
    settlementAmount: string | null;
    settlementTxHash: string | null;
    transferIndex: number | null;
  }> | null;
  invoiceCandidates: EvidenceValue<
    Array<{
      id: string;
      status: string;
      performanceFee: string;
      periodStart: string;
    }>
  >;
  applications: EvidenceValue<
    Array<{
      id: string;
      invoiceId: string;
      appliedAmount: string;
      applicationSource: SettlementApplicationSource;
    }>
  >;
};

export type ReconciliationCaseView = {
  id: string;
  organizationId: string;
  settlementId: string;
  paymentId: string;
  exchangeAccountId: string;
  exceptionReason: string | null;
  status: ReconciliationCaseStatus;
  priority: number;
  resolutionType: ReconciliationResolutionType | null;
  currentDecisionId: string | null;
  assignedTo: string | null;
  claimExpiresAt: Date | null;
  coolingOffUntil: Date | null;
  openedAt: Date;
  resolvedAt: Date | null;
  lastEventSeq: number;
  lastEventDigest: string;
};

export type ReconciliationEventPayloadInput = {
  organizationId: string;
  caseId: string;
  seq: number;
  eventType: string;
  actorType: (typeof auditActorTypeEnum)[number];
  actorId: string | null;
  payload: ReconciliationEventPayload;
  prevEventDigest: string | null;
};

export type ReconciliationEventRecordPayload = ReconciliationEventPayloadInput & {
  schemaVersion: ReconciliationEventSchemaVersion;
  recordContentDigest: string;
};

export type ReconciliationEventRecordView = ReconciliationEventRecordPayload & {
  id: string;
  createdAt: Date;
};

export type ReconciliationCaseListItem = ReconciliationCaseView & {
  settlementTxHash: string | null;
  valuedAmount: string | null;
};

export type ReconciliationCaseDetail = {
  case: ReconciliationCaseView;
  events: ReconciliationEventRecordView[];
  evidence: ReconciliationEvidenceSnapshot;
};

export type ReconciliationCaseListQuery = {
  status?: ReconciliationCaseStatus;
  exceptionReason?: string;
  limit?: number;
  cursor?: string;
};

export type ReconciliationCaseListResult = {
  items: ReconciliationCaseListItem[];
  nextCursor: string | null;
};

export type ReconciliationHealthMetrics = {
  openCount: number;
  staleCount: number;
  orphanExceptionCount: number;
  openAgeP95Seconds: number | null;
};

export type ReconciliationCommandBase = {
  caseId: string;
  expectedLastEventSeq: number;
  idempotencyKey: string;
};

export type ReconciliationOperatorContext = {
  actorType: "user" | "admin";
  actorId: string;
};

export const settlementReconciliationEffectiveOutcomes = [
  "FINANCIALLY_APPLIED",
  "CLOSED_WITHOUT_APPLICATION",
  "PENDING_RECONCILIATION",
] as const;

export type SettlementReconciliationEffectiveOutcome =
  (typeof settlementReconciliationEffectiveOutcomes)[number];

export function inlineEvidenceValue<T>(value: T): EvidenceValue<T> {
  return { kind: "inline", value };
}

export function unwrapEvidenceValue<T>(field: EvidenceValue<T>): T {
  if (field.kind === "inline") {
    return field.value;
  }
  throw new Error(
    `[trader/settlement/reconciliation] evidence reference not resolved: ${field.ref}`,
  );
}
