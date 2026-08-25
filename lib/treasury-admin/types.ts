import type { AccountingStatus, DetailPublicationState } from "@/lib/treasury-admin/publication";
import type { CommitmentStatus } from "@/lib/treasury-admin/commitment-actions";

export type TreasuryOrganization = {
  id: string;
  name: string | null;
  kind: string;
};

export type TreasuryTransactionDto = {
  id: string;
  organizationId: string;
  status: AccountingStatus;
  detailPublication: DetailPublicationState;
  provenance: "WATCHER" | "MANUAL";
  direction: "INFLOW" | "OUTFLOW" | "INTERNAL";
  kind: string | null;
  fundBucketCode: string;
  nativeAmountAtomic: string | null;
  nativeDecimals: number;
  nativeAsset: string | null;
  nativeContract: string | null;
  accountingAmountMicros: string | null;
  cashEffectMicros: string | null;
  signedAmountMicros: string | null;
  counterpartyId: string | null;
  accountId: string | null;
  categoryId: string | null;
  projectId: string | null;
  occurredAt: string | null;
  purpose: string | null;
  category: string | null;
  counterpartyDisplay: string | null;
  publishCounterparty: boolean;
  projectModule: string | null;
  milestoneStage: string | null;
  budgetId: string | null;
  fundingNeedId: string | null;
  description: string | null;
  publicDescription: string | null;
  internalNotes: string | null;
  txHash: string | null;
  canonicalNetwork: string | null;
  canonicalTokenContract: string | null;
  canonicalTxHash: string | null;
  canonicalTransferIndex: number | null;
  correctsTransactionId: string | null;
  duplicateOfTransactionId: string | null;
  detailSupersededById: string | null;
  verifiedAt: string | null;
  verifiedByUserId: string | null;
  detailPublishedAt: string | null;
  detailPublishedByUserId: string | null;
  createdByUserId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type TreasuryCounterpartySummaryDto = {
  id: string;
  displayName: string;
  waiaUsername: string | null;
  isActive: boolean;
};

export type TreasuryCounterpartyDto = TreasuryCounterpartySummaryDto & {
  organizationId: string;
  waiaUserId: string | null;
  websiteUrl: string | null;
  email: string | null;
  phone: string | null;
  paymentInstructions: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TreasuryAccountSummaryDto = {
  id: string;
  displayName: string;
  kind: "CRYPTO_WALLET" | "BANK_CARD" | "BANK_ACCOUNT" | "CASH" | "OTHER";
  currency: string;
  network: string | null;
  isActive: boolean;
};

export type TreasuryAccountDto = TreasuryAccountSummaryDto & {
  organizationId: string;
  address: string | null;
  maskedRequisites: string | null;
  watchedAddressId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TreasuryCategoryDto = {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  groupName: string;
  description: string | null;
  monthlyBudgetMicros: string;
  currency: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TreasuryCategoryBudgetTotalDto = {
  currency: string;
  budgetMicros: string;
  spentMicros: string;
  remainingMicros: string;
};

export type TreasuryCategoryBudgetCategoryDto = TreasuryCategoryBudgetTotalDto & {
  categoryId: string;
  code: string;
  name: string;
  groupName: string;
  isActive: boolean;
};

export type TreasuryCategoryBudgetGroupDto = TreasuryCategoryBudgetTotalDto & {
  groupName: string;
};

export type TreasuryCategoryBudgetMonthDto = {
  month: string;
  categories: TreasuryCategoryBudgetCategoryDto[];
  groups: TreasuryCategoryBudgetGroupDto[];
  totals: TreasuryCategoryBudgetTotalDto[];
};

export type TreasuryCategoryBudgetAnnualDto = {
  year: number;
  totals: TreasuryCategoryBudgetTotalDto[];
  months: TreasuryCategoryBudgetMonthDto[];
};

export type TreasuryProjectDto = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  startsOn: string | null;
  endsOn: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TreasuryLedgerCatalogKind = "counterparties" | "accounts" | "categories" | "projects";

export type TreasuryLedgerCatalogItem =
  | TreasuryCounterpartySummaryDto
  | TreasuryAccountSummaryDto
  | TreasuryCategoryDto
  | TreasuryProjectDto;

export type TreasuryLedgerCatalogPage<T extends TreasuryLedgerCatalogItem> = {
  next: { afterName: string; afterId: string } | null;
} & Partial<Record<TreasuryLedgerCatalogKind, T[]>>;

export type TreasuryObservationDto = {
  id: string;
  organizationId: string;
  observationStatus: string;
  confirmationsObserved: number;
  confirmationsRequired: number;
};

export type TreasuryRevisionDto = {
  id: string;
  transactionId: string;
  seq: number;
  actorType: string;
  actorUserId: string | null;
  reason: string | null;
  createdAt: string | null;
};

export type TreasuryEvidenceLinkDto = {
  id: string;
  organizationId: string;
  transactionId: string;
  evidenceObjectId: string;
};

export type TreasuryTransactionDetailDto = {
  transaction: TreasuryTransactionDto;
  observations: TreasuryObservationDto[];
  revisions: TreasuryRevisionDto[];
  evidenceLinks: TreasuryEvidenceLinkDto[];
  attributions: { id: string; status: string; contributorUserId: string | null }[];
};

export type TreasuryBudgetDto = {
  id: string;
  organizationId: string;
  code: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  plannedAmountMicros: string | null;
  status: string;
  isPublic: boolean;
  notes: string | null;
  funded?: string | null;
  committed?: string | null;
  spent?: string | null;
  remaining?: string | null;
};

export type TreasuryFundingNeedDto = {
  id: string;
  organizationId: string;
  title: string;
  publicExplanation: string | null;
  targetStage: string | null;
  requiredAmountMicros: string | null;
  currency: string;
  status: string;
  isPublic: boolean;
  budgetId: string | null;
  funded?: string | null;
  remaining?: string | null;
};

export type TreasuryCommitmentDto = {
  id: string;
  organizationId: string;
  status: CommitmentStatus;
  amountMicros: string | null;
  currency: string;
  purpose: string;
  budgetId: string | null;
  detailPublication: DetailPublicationState;
  counterpartyDisplay: string | null;
  publishCounterparty: boolean;
  expectedAt: string | null;
  effectiveFrom: string | null;
  evidenceObjectId: string | null;
  createdByUserId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  releasedByUserId: string | null;
  releasedAt: string | null;
  fulfilledByUserId: string | null;
  fulfilledAt: string | null;
  cancelledByUserId: string | null;
  cancelledAt: string | null;
  fulfillsTransactionId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type TreasuryEvidenceObjectDto = {
  id: string;
  organizationId: string;
  kind: string;
  visibility: string;
  mediaType: string | null;
  byteSize: string | null;
  sha256: string | null;
  source: string | null;
  storageBackend: string | null;
  objectKey: string | null;
  uploadedByUserId: string | null;
  createdAt: string | null;
};

export type TreasuryOverviewCountsDto = {
  reviewRequiredCount: number;
  publicationPendingCount: number;
};

export type TreasuryFundAllocationDto =
  | { status: "unavailable"; reason: string }
  | {
      status: "available";
      accountingCurrency: string;
      accountingAsOf: string;
      canonicalFreeFundsMicros: string;
      protectedAnnualBudgetMicros: string;
      operatingAllocationMicros: string;
      developmentAllocationMicros: string;
      policyCode: string;
      policyVersion: number;
      evidenceId: string;
      inputDigest: string;
      outputDigest: string;
    };

export type TreasuryWatchedAddressDto = {
  id: string;
  organizationId: string;
  network: "TRC-20";
  address: string;
  tokenContract: string;
  assetCode: string;
  directionScope: "INBOUND" | "OUTBOUND" | "BOTH";
  includeInBalanceRecon: boolean;
  label: string;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type BreathPublicActivityDto = {
  occurredAt: string;
  kind: string | null;
  direction: string;
  publicDescription: string | null;
  cashEffectMicros: string | null;
  accountingAmountMicros: string | null;
  counterpartyDisplay: string | null;
};

export type BreathAdminPreviewDto = {
  status: "pending" | "published";
  lastUpdatedAt: string | null;
  stageLabel: string | null;
  work: string | null;
  methodologyNote: string | null;
  idealAnnualBudget: { periodYear: number; currency: string; amount: string } | null;
  resources: {
    entered: string;
    spent: string;
    remaining: string;
    allocated: string;
    neededNext: string | null;
  } | null;
  currentFreeFunds: string | null;
  budget: {
    code: string;
    title: string;
    currency: string;
    planned: string;
    funded: string;
    committed: string;
    spent: string;
    remaining: string;
    fillRatio: number;
  } | null;
  runway:
    | { status: "pending" }
    | {
        status: "available";
        runwayAsOf: string;
        endsAt: string;
        freeFundsAtAsOf: string;
        approvedDailyBurn: string;
      };
  recentActivity: BreathPublicActivityDto[];
  pendingReasons: string[];
  componentStatus: {
    breathEnabled: boolean;
    idealBudget: string;
    materialReconciliation: boolean;
    balanceReconciliation: string;
    budget: string;
    fundingNeed: string;
    verifiedFinancialComplete: boolean;
  };
  reconciliationGate: {
    latestId: string | null;
    status: string | null;
    createdAt: string | null;
  };
  runwayStatus: {
    status: string;
    reason: string | null;
    snapshotId: string | null;
  };
};

export type TreasurySettingsDto = {
  organizationId: string;
  breathEnabled: boolean;
  stageLabel: string | null;
  workSummary: string | null;
  methodologyNote: string | null;
  recentActivityLimit: number;
  updatedAt: string | null;
};

export type TreasuryApiError = {
  ok: false;
  status: number;
  code: string;
  message: string;
};

export type TreasuryApiOk<T> = { ok: true; data: T };

export type TreasuryApiResult<T> = TreasuryApiOk<T> | TreasuryApiError;
