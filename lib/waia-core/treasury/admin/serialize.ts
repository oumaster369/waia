import { serializeDecimalBigint } from "@/lib/waia-core/treasury/admin/money";
import type {
  TreasuryCommitmentRecord,
  TreasuryTransactionRecord,
} from "@/lib/waia-core/treasury/types";
import type { TreasuryChainObservationRecord } from "@/lib/waia-core/treasury/watcher/types";
import type {
  TreasuryBudgetDerivedTotals,
  TreasuryFundingNeedDerivedTotals,
} from "@/lib/waia-core/treasury/admin/derived-reads";
import type {
  TreasuryAdminAttribution,
  TreasuryBudgetRecord,
  TreasuryEvidenceObjectRecord,
  TreasuryFundingNeedRecord,
  TreasuryIdealBudgetRecord,
  TreasuryPublicationSettingsRecord,
  TreasuryRunwayPlanRecord,
} from "@/lib/waia-core/treasury/admin/catalog-types";
import type { TreasuryBalanceReconciliationRecord } from "@/lib/waia-core/treasury/watcher/types";
import type { TreasuryInceptionRecord } from "@/lib/waia-core/treasury/types";
import type { TreasuryWatchedAddressRecord } from "@/lib/waia-core/treasury/watcher/types";
import type { FundAllocationCurrent } from "@/lib/waia-core/treasury/allocation/types";
import type { TreasuryRevisionRecord } from "@/lib/waia-core/treasury/types";
import type { TreasuryEvidenceLinkRecord } from "@/lib/waia-core/treasury/types";
import type { TreasuryObservationRecord } from "@/lib/waia-core/treasury/types";

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function serializeTransaction(tx: TreasuryTransactionRecord): Record<string, unknown> {
  const signedAmountMicros =
    tx.accountingAmountMicros === null
      ? null
      : tx.direction === "OUTFLOW"
        ? -tx.accountingAmountMicros
        : tx.direction === "INTERNAL"
          ? 0n
          : tx.accountingAmountMicros;
  return {
    id: tx.id,
    organizationId: tx.organizationId,
    status: tx.status,
    detailPublication: tx.detailPublication,
    provenance: tx.provenance,
    direction: tx.direction,
    kind: tx.kind,
    fundBucketCode: tx.fundBucketCode,
    nativeAmountAtomic: serializeDecimalBigint(tx.nativeAmountAtomic),
    nativeDecimals: tx.nativeDecimals,
    nativeAsset: tx.nativeAsset,
    nativeContract: tx.nativeContract,
    accountingAmountMicros: serializeDecimalBigint(tx.accountingAmountMicros),
    accountingDenominationPolicy: tx.accountingDenominationPolicy,
    cashEffectMicros: serializeDecimalBigint(tx.cashEffectMicros),
    signedAmountMicros: serializeDecimalBigint(signedAmountMicros),
    counterpartyIsInternal: tx.counterpartyIsInternal,
    counterpartyId: tx.counterpartyId,
    accountId: tx.accountId,
    categoryId: tx.categoryId,
    projectId: tx.projectId,
    occurredAt: iso(tx.occurredAt),
    purpose: tx.purpose,
    category: tx.category,
    counterpartyDisplay: tx.counterpartyDisplay,
    publishCounterparty: tx.publishCounterparty,
    projectModule: tx.projectModule,
    milestoneStage: tx.milestoneStage,
    budgetId: tx.budgetId,
    fundingNeedId: tx.fundingNeedId,
    description: tx.description,
    publicDescription: tx.publicDescription,
    internalNotes: tx.internalNotes,
    txHash: tx.txHash,
    canonicalNetwork: tx.canonicalNetwork,
    canonicalTokenContract: tx.canonicalTokenContract,
    canonicalTxHash: tx.canonicalTxHash,
    canonicalTransferIndex: tx.canonicalTransferIndex,
    correctsTransactionId: tx.correctsTransactionId,
    duplicateOfTransactionId: tx.duplicateOfTransactionId,
    detailSupersededById: tx.detailSupersededById,
    ledgerInceptionId: tx.ledgerInceptionId,
    verifiedAt: iso(tx.verifiedAt),
    verifiedByUserId: tx.verifiedByUserId,
    detailPublishedAt: iso(tx.detailPublishedAt),
    detailPublishedByUserId: tx.detailPublishedByUserId,
    createdByUserId: tx.createdByUserId,
    createdAt: iso(tx.createdAt),
    updatedAt: iso(tx.updatedAt),
  };
}

export function serializeObservationProjection(
  row: TreasuryObservationRecord,
): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    observationStatus: row.observationStatus,
    confirmationsObserved: row.confirmationsObserved,
    confirmationsRequired: row.confirmationsRequired,
  };
}

export function serializeChainObservation(
  row: TreasuryChainObservationRecord,
): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    watchedAddressId: row.watchedAddressId,
    direction: row.direction,
    txHash: row.txHash,
    transferIndex: row.transferIndex,
    nativeAmountAtomic: serializeDecimalBigint(row.nativeAmountAtomic),
    blockHeight: row.blockHeight,
    observationStatus: row.observationStatus,
    confirmationsObserved: row.confirmationsObserved,
    confirmationsRequired: row.confirmationsRequired,
    relatedPaymentId: row.relatedPaymentId,
  };
}

export function serializeRevision(row: TreasuryRevisionRecord): Record<string, unknown> {
  return {
    id: row.id,
    transactionId: row.transactionId,
    seq: row.seq,
    actorType: row.actorType,
    actorUserId: row.actorUserId,
    reason: row.reason,
    createdAt: iso(row.createdAt),
  };
}

export function serializeTransactionDetail(input: {
  transaction: TreasuryTransactionRecord;
  observations: TreasuryObservationRecord[];
  revisions: TreasuryRevisionRecord[];
  evidenceLinks: TreasuryEvidenceLinkRecord[];
  attributions: { id: string; status: string; contributorUserId: string | null }[];
}): Record<string, unknown> {
  return {
    transaction: serializeTransaction(input.transaction),
    observations: input.observations.map(serializeObservationProjection),
    revisions: input.revisions.map(serializeRevision),
    evidenceLinks: input.evidenceLinks.map(serializeEvidenceLink),
    attributions: input.attributions.map((row) => ({
      id: row.id,
      status: row.status,
      contributorUserId: row.contributorUserId,
    })),
  };
}

export function serializeEvidenceLink(row: TreasuryEvidenceLinkRecord): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    transactionId: row.transactionId,
    evidenceObjectId: row.evidenceObjectId,
  };
}

export function serializeCommitment(row: TreasuryCommitmentRecord): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    status: row.status,
    amountMicros: serializeDecimalBigint(row.amountMicros),
    currency: row.currency,
    purpose: row.purpose,
    budgetId: row.budgetId,
    detailPublication: row.detailPublication,
    counterpartyDisplay: row.counterpartyDisplay,
    publishCounterparty: row.publishCounterparty,
    expectedAt: row.expectedAt,
    effectiveFrom: iso(row.effectiveFrom),
    evidenceObjectId: row.evidenceObjectId,
    createdByUserId: row.createdByUserId,
    approvedByUserId: row.approvedByUserId,
    approvedAt: iso(row.approvedAt),
    releasedByUserId: row.releasedByUserId,
    releasedAt: iso(row.releasedAt),
    fulfilledByUserId: row.fulfilledByUserId,
    fulfilledAt: iso(row.fulfilledAt),
    cancelledByUserId: row.cancelledByUserId,
    cancelledAt: iso(row.cancelledAt),
    fulfillsTransactionId: row.fulfillsTransactionId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function serializeWatchedAddress(
  row: TreasuryWatchedAddressRecord,
): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    network: row.network,
    address: row.address,
    tokenContract: row.tokenContract,
    assetCode: row.assetCode,
    directionScope: row.directionScope,
    includeInBalanceRecon: row.includeInBalanceRecon,
    label: row.label,
    isActive: row.isActive,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function serializeFundAllocation(row: FundAllocationCurrent): Record<string, unknown> {
  if (row.status === "unavailable") {
    return { status: "unavailable", reason: row.reason };
  }
  const evidence = row.evidence;
  return {
    status: "available",
    accountingCurrency: evidence.accountingCurrency,
    accountingAsOf: iso(evidence.accountingAsOf),
    canonicalFreeFundsMicros: serializeDecimalBigint(evidence.canonicalFreeFundsMicros),
    protectedAnnualBudgetMicros: serializeDecimalBigint(evidence.protectedAnnualBudgetMicros),
    operatingAllocationMicros: serializeDecimalBigint(evidence.operatingAllocationMicros),
    developmentAllocationMicros: serializeDecimalBigint(evidence.developmentAllocationMicros),
    policyCode: evidence.policyCode,
    policyVersion: evidence.policyVersion,
    evidenceId: evidence.id,
    inputDigest: evidence.inputDigest,
    outputDigest: evidence.outputDigest,
  };
}

export function serializeBudget(
  row: TreasuryBudgetRecord,
  derived?: TreasuryBudgetDerivedTotals,
): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    title: row.title,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    currency: row.currency,
    plannedAmountMicros: serializeDecimalBigint(row.plannedAmountMicros),
    status: row.status,
    isPublic: row.isPublic,
    notes: row.notes,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    ...(derived
      ? {
          funded: serializeDecimalBigint(derived.funded),
          committed: serializeDecimalBigint(derived.committed),
          spent: serializeDecimalBigint(derived.spent),
          remaining: serializeDecimalBigint(derived.remaining),
        }
      : {}),
  };
}

export function serializeFundingNeed(
  row: TreasuryFundingNeedRecord,
  derived?: TreasuryFundingNeedDerivedTotals,
): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    title: row.title,
    publicExplanation: row.publicExplanation,
    targetStage: row.targetStage,
    requiredAmountMicros: serializeDecimalBigint(row.requiredAmountMicros),
    currency: row.currency,
    status: row.status,
    isPublic: row.isPublic,
    budgetId: row.budgetId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    ...(derived
      ? {
          funded: serializeDecimalBigint(derived.funded),
          remaining: serializeDecimalBigint(derived.remaining),
        }
      : {}),
  };
}

export function serializeIdealBudget(row: TreasuryIdealBudgetRecord): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    periodYear: row.periodYear,
    currency: row.currency,
    amountMicros: serializeDecimalBigint(row.amountMicros),
    status: row.status,
    publicationState: row.publicationState,
    createdAt: iso(row.createdAt),
  };
}

export function serializeRunwayPlan(row: TreasuryRunwayPlanRecord): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    method: row.method,
    currency: row.currency,
    dailyBurnMicros: serializeDecimalBigint(row.dailyBurnMicros),
    status: row.status,
    effectiveFrom: iso(row.effectiveFrom),
    effectiveTo: iso(row.effectiveTo),
    createdAt: iso(row.createdAt),
  };
}

export function serializeSettings(row: TreasuryPublicationSettingsRecord): Record<string, unknown> {
  return {
    organizationId: row.organizationId,
    breathEnabled: row.breathEnabled,
    stageLabel: row.stageLabel,
    workSummary: row.workSummary,
    methodologyNote: row.methodologyNote,
    recentActivityLimit: row.recentActivityLimit,
    updatedAt: iso(row.updatedAt),
  };
}

export function serializeAttribution(row: TreasuryAdminAttribution): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    transactionId: row.transactionId,
    status: row.status,
    contributorUserId: row.contributorUserId,
    consentPublicIdentity: row.consentPublicIdentity,
    attributionMethod: row.attributionMethod,
    note: row.note,
    revokedAt: iso(row.revokedAt),
    createdAt: iso(row.createdAt),
  };
}

export function serializeEvidenceObject(
  row: TreasuryEvidenceObjectRecord,
): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    kind: row.kind,
    visibility: row.visibility,
    mediaType: row.mediaType,
    byteSize: serializeDecimalBigint(row.byteSize),
    sha256: row.sha256,
    source: row.source,
    storageBackend: row.storageBackend,
    objectKey: row.objectKey,
    uploadedByUserId: row.uploadedByUserId,
    createdAt: iso(row.createdAt),
  };
}

export function serializeInception(row: TreasuryInceptionRecord): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    network: row.network,
    tokenContract: row.tokenContract,
    assetCode: row.assetCode,
    inceptionBlock: row.inceptionBlock,
    watcherStartBlock: row.watcherStartBlock,
    status: row.status,
    openingBalanceTransactionId: row.openingBalanceTransactionId,
    createdAt: iso(row.createdAt),
  };
}

export function serializeRunwaySnapshot(row: {
  id: string;
  organizationId: string;
  runwayPlanId: string;
  runwayAsOf: Date;
  freeFundsAtAsOfMicros: bigint;
  approvedDailyBurnMicros: bigint;
  endsAt: Date;
  inputDigest: string;
  createdAt: Date;
}): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    runwayPlanId: row.runwayPlanId,
    runwayAsOf: iso(row.runwayAsOf),
    freeFundsAtAsOfMicros: serializeDecimalBigint(row.freeFundsAtAsOfMicros),
    approvedDailyBurnMicros: serializeDecimalBigint(row.approvedDailyBurnMicros),
    endsAt: iso(row.endsAt),
    inputDigest: row.inputDigest,
    createdAt: iso(row.createdAt),
  };
}

export function serializeReconciliation(
  row: TreasuryBalanceReconciliationRecord,
): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    asOfBlock: row.asOfBlock,
    asOfTime: iso(row.asOfTime),
    observedOnchainBalanceAtomic: serializeDecimalBigint(row.observedOnchainBalanceAtomic),
    accountingCashBalanceMicros: serializeDecimalBigint(row.accountingCashBalanceMicros),
    deltaMicros: serializeDecimalBigint(row.deltaMicros),
    explainedPendingMicros: serializeDecimalBigint(row.explainedPendingMicros),
    unexplainedResidualMicros: serializeDecimalBigint(row.unexplainedResidualMicros),
    status: row.status,
    toleranceMicros: serializeDecimalBigint(row.toleranceMicros),
    createdAt: iso(row.createdAt),
  };
}
