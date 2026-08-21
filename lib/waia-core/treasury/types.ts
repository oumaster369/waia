import type {
  treasuryAttributionStatusEnum,
  treasuryCommitmentStatusEnum,
  treasuryDetailPublicationEnum,
  treasuryInceptionStatusEnum,
  treasuryObservationStatusEnum,
  treasuryProvenanceEnum,
  treasuryTxDirectionEnum,
  treasuryTxKindEnum,
  treasuryTxStatusEnum,
} from "@/db/core-enums";
import type { AuditActorType } from "@/lib/waia-core/types";

export type TreasuryTxStatus = (typeof treasuryTxStatusEnum)[number];
export type TreasuryDetailPublication = (typeof treasuryDetailPublicationEnum)[number];
export type TreasuryTxDirection = (typeof treasuryTxDirectionEnum)[number];
export type TreasuryTxKind = (typeof treasuryTxKindEnum)[number];
export type TreasuryProvenance = (typeof treasuryProvenanceEnum)[number];
export type TreasuryCommitmentStatus = (typeof treasuryCommitmentStatusEnum)[number];
export type TreasuryAttributionStatus = (typeof treasuryAttributionStatusEnum)[number];
export type TreasuryInceptionStatus = (typeof treasuryInceptionStatusEnum)[number];
export type TreasuryObservationStatus = (typeof treasuryObservationStatusEnum)[number];

export const USDT_NOMINAL_USD_POLICY_V1 = "USDT_NOMINAL_USD_POLICY_V1" as const;
export type UsdtNominalUsdPolicyV1 = typeof USDT_NOMINAL_USD_POLICY_V1;

export const TREASURY_USDT_V1_ASSET = "USDT" as const;
export const TREASURY_USDT_V1_NETWORK = "TRC-20" as const;
export const TREASURY_USDT_V1_DECIMALS = 6 as const;
/** Canonical USDT TRC-20 mainnet contract; same identity as `USDT_TRC20_CONTRACT`. */
export const TREASURY_USDT_V1_TOKEN_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" as const;

export type TreasuryActorContext = {
  actorType: AuditActorType;
  actorUserId?: string | null;
};

export type TreasuryTransactionRecord = {
  id: string;
  organizationId: string;
  status: TreasuryTxStatus;
  detailPublication: TreasuryDetailPublication;
  provenance: TreasuryProvenance;
  canonicalNetwork: string | null;
  canonicalTokenContract: string | null;
  canonicalTxHash: string | null;
  canonicalTransferIndex: number | null;
  direction: TreasuryTxDirection;
  kind: TreasuryTxKind | null;
  fundBucketCode: string;
  nativeAmountAtomic: bigint;
  nativeDecimals: number;
  nativeAsset: string;
  nativeContract: string | null;
  accountingAmountMicros: bigint | null;
  accountingDenominationPolicy: string | null;
  cashEffectMicros: bigint | null;
  counterpartyIsInternal: boolean;
  counterpartyId: string | null;
  accountId: string | null;
  categoryId: string | null;
  projectId: string | null;
  occurredAt: Date;
  purpose: string | null;
  category: string | null;
  counterpartyDisplay: string | null;
  publishCounterparty: boolean;
  projectModule: string | null;
  milestoneStage: string | null;
  budgetId: string | null;
  fundingNeedId: string | null;
  description: string | null;
  internalNotes: string | null;
  publicDescription: string | null;
  txHash: string | null;
  correctsTransactionId: string | null;
  duplicateOfTransactionId: string | null;
  detailSupersededById: string | null;
  ledgerInceptionId: string | null;
  verifiedAt: Date | null;
  verifiedByUserId: string | null;
  detailPublishedAt: Date | null;
  detailPublishedByUserId: string | null;
  latestRevisionId: string | null;
  recordContentDigest: string;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TreasuryObservationRecord = {
  id: string;
  organizationId: string;
  observationStatus: TreasuryObservationStatus;
  confirmationsObserved: number;
  confirmationsRequired: number;
};

export type TreasuryEvidenceLinkRecord = {
  id: string;
  organizationId: string;
  transactionId: string;
  evidenceObjectId: string;
};

export type TreasuryRevisionRecord = {
  id: string;
  organizationId: string;
  transactionId: string;
  seq: number;
  patchJson: Record<string, unknown>;
  actorUserId: string | null;
  actorType: string;
  reason: string | null;
  contentDigest: string;
  prevRevisionDigest: string | null;
  createdAt: Date;
};

export type TreasuryCommitmentRecord = {
  id: string;
  organizationId: string;
  budgetId: string | null;
  amountMicros: bigint;
  currency: string;
  purpose: string;
  counterpartyDisplay: string | null;
  publishCounterparty: boolean;
  detailPublication: TreasuryDetailPublication;
  expectedAt: string | null;
  effectiveFrom: Date;
  status: TreasuryCommitmentStatus;
  evidenceObjectId: string | null;
  createdByUserId: string;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  releasedByUserId: string | null;
  releasedAt: Date | null;
  fulfilledByUserId: string | null;
  fulfilledAt: Date | null;
  cancelledByUserId: string | null;
  cancelledAt: Date | null;
  fulfillsTransactionId: string | null;
  recordContentDigest: string;
  createdAt: Date;
  updatedAt: Date;
};

export type TreasuryCommitmentRevisionRecord = {
  id: string;
  organizationId: string;
  commitmentId: string;
  seq: number;
  patchJson: Record<string, unknown>;
  actorUserId: string | null;
  actorType: string;
  reason: string | null;
  contentDigest: string;
  prevRevisionDigest: string | null;
  createdAt: Date;
};

export type TreasuryInceptionRecord = {
  id: string;
  organizationId: string;
  network: string;
  tokenContract: string;
  assetCode: string;
  inceptionBlock: string;
  inceptionBlockHash: string | null;
  inceptionTime: Date;
  openingBalanceTransactionId: string;
  watcherStartBlock: string;
  evidenceObjectId: string | null;
  status: TreasuryInceptionStatus;
  createdByUserId: string;
  approvedByUserId: string;
  createdAt: Date;
};

export type TreasuryAttributionRecord = {
  id: string;
  organizationId: string;
  transactionId: string;
  status: TreasuryAttributionStatus;
  contributorUserId: string | null;
  revokedAt: Date | null;
};

export type TreasurySemanticPatch = {
  kind?: TreasuryTxKind | null;
  direction?: TreasuryTxDirection;
  fundBucketCode?: string;
  accountingAmountMicros?: bigint | null;
  accountingDenominationPolicy?: string | null;
  cashEffectMicros?: bigint | null;
  purpose?: string | null;
  category?: string | null;
  counterpartyDisplay?: string | null;
  publishCounterparty?: boolean;
  projectModule?: string | null;
  milestoneStage?: string | null;
  budgetId?: string | null;
  fundingNeedId?: string | null;
  description?: string | null;
  internalNotes?: string | null;
  publicDescription?: string | null;
  correctsTransactionId?: string | null;
  duplicateOfTransactionId?: string | null;
  detailSupersededById?: string | null;
  ledgerInceptionId?: string | null;
  counterpartyIsInternal?: boolean;
  counterpartyId?: string | null;
  accountId?: string | null;
  categoryId?: string | null;
  projectId?: string | null;
};
