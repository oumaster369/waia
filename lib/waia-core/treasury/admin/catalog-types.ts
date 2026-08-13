import {
  treasuryAttributionStatusEnum,
  treasuryBudgetStatusEnum,
  treasuryEvidenceKindEnum,
  treasuryEvidenceVisibilityEnum,
  treasuryFundingNeedStatusEnum,
  treasuryIdealBudgetPublicationEnum,
  treasuryIdealBudgetStatusEnum,
  treasuryRunwayPlanStatusEnum,
} from "@/db/core-enums";
import type { TreasuryAddressDirectionScope } from "@/lib/waia-core/treasury/watcher/types";

export type TreasuryBudgetStatus = (typeof treasuryBudgetStatusEnum)[number];
export type TreasuryFundingNeedStatus = (typeof treasuryFundingNeedStatusEnum)[number];
export type TreasuryIdealBudgetStatus = (typeof treasuryIdealBudgetStatusEnum)[number];
export type TreasuryIdealBudgetPublication = (typeof treasuryIdealBudgetPublicationEnum)[number];
export type TreasuryRunwayPlanStatus = (typeof treasuryRunwayPlanStatusEnum)[number];
export type TreasuryEvidenceKind = (typeof treasuryEvidenceKindEnum)[number];
export type TreasuryEvidenceVisibility = (typeof treasuryEvidenceVisibilityEnum)[number];
export type TreasuryAdminAttributionStatus = (typeof treasuryAttributionStatusEnum)[number];

export type TreasuryBudgetRecord = {
  id: string;
  organizationId: string;
  code: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  plannedAmountMicros: bigint;
  status: TreasuryBudgetStatus;
  isPublic: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TreasuryFundingNeedRecord = {
  id: string;
  organizationId: string;
  title: string;
  publicExplanation: string | null;
  targetStage: string | null;
  requiredAmountMicros: bigint;
  currency: string;
  status: TreasuryFundingNeedStatus;
  isPublic: boolean;
  budgetId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TreasuryIdealBudgetRecord = {
  id: string;
  organizationId: string;
  periodYear: number;
  currency: string;
  amountMicros: bigint;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  status: TreasuryIdealBudgetStatus;
  publicationState: TreasuryIdealBudgetPublication;
  createdByUserId: string;
  approvedByUserId: string | null;
  createdAt: Date;
};

export type TreasuryRunwayPlanRecord = {
  id: string;
  organizationId: string;
  method: string;
  currency: string;
  dailyBurnMicros: bigint;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  status: TreasuryRunwayPlanStatus;
  createdByUserId: string;
  approvedByUserId: string | null;
  createdAt: Date;
};

export type TreasuryPublicationSettingsRecord = {
  organizationId: string;
  breathEnabled: boolean;
  stageLabel: string | null;
  workSummary: string | null;
  methodologyNote: string;
  recentActivityLimit: number;
  updatedByUserId: string | null;
  updatedAt: Date;
};

export type TreasuryEvidenceObjectRecord = {
  id: string;
  organizationId: string;
  storageBackend: string;
  objectKey: string;
  mediaType: string;
  byteSize: bigint;
  sha256: string;
  kind: TreasuryEvidenceKind;
  visibility: TreasuryEvidenceVisibility;
  source: string;
  uploadedByUserId: string | null;
  observedAt: Date;
  createdAt: Date;
};

export type TreasuryAdminAttribution = {
  id: string;
  organizationId: string;
  transactionId: string;
  status: TreasuryAdminAttributionStatus;
  contributorUserId: string | null;
  attributionMethod: string;
  consentPublicIdentity: boolean;
  note: string | null;
  attributedByUserId: string | null;
  attributedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

export type TreasuryWatchedAddressPatch = {
  directionScope?: TreasuryAddressDirectionScope;
  includeInBalanceRecon?: boolean;
  label?: string;
  isActive?: boolean;
};
