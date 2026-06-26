import {
  auditActorTypeEnum,
  settlementApplicationSourceEnum,
  settlementReconciliationCaseStatusEnum,
} from "@/db/core-enums";
import type { SettlementRecordView } from "@/lib/trader/settlement/settlement.types";

export const RECONCILIATION_EVENT_SCHEMA_VERSION =
  "waia.trader.settlement-reconciliation-event.v1" as const;
export type ReconciliationEventSchemaVersion = typeof RECONCILIATION_EVENT_SCHEMA_VERSION;

export const reconciliationCaseStatuses = settlementReconciliationCaseStatusEnum;
export type ReconciliationCaseStatus = (typeof reconciliationCaseStatuses)[number];

export const settlementApplicationSources = settlementApplicationSourceEnum;
export type SettlementApplicationSource = (typeof settlementApplicationSources)[number];

export type ReconciliationCaseView = {
  id: string;
  organizationId: string;
  settlementId: string;
  paymentId: string;
  exchangeAccountId: string;
  exceptionReason: string | null;
  status: ReconciliationCaseStatus;
  priority: number;
  resolutionType: string | null;
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
  payload: ReconciliationEvidenceSnapshot;
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

export type ReconciliationEvidenceSnapshot = {
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
  payment: {
    paymentId: string;
    settlementNetwork: string | null;
    settlementAsset: string | null;
    settlementAmount: string | null;
    settlementTxHash: string | null;
    transferIndex: number | null;
  } | null;
  invoiceCandidates: Array<{
    id: string;
    status: string;
    performanceFee: string;
    periodStart: string;
  }>;
  applications: Array<{
    id: string;
    invoiceId: string;
    appliedAmount: string;
    applicationSource: SettlementApplicationSource;
  }>;
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
