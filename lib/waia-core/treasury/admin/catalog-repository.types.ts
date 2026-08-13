import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type {
  TreasuryAdminAttribution,
  TreasuryBudgetRecord,
  TreasuryEvidenceObjectRecord,
  TreasuryFundingNeedRecord,
  TreasuryIdealBudgetRecord,
  TreasuryPublicationSettingsRecord,
  TreasuryRunwayPlanRecord,
  TreasuryWatchedAddressPatch,
} from "@/lib/waia-core/treasury/admin/catalog-types";
import type { TreasuryWatchedAddressRecord } from "@/lib/waia-core/treasury/watcher/types";

export type TreasuryCatalogRepository = {
  listWatchedAddresses(context: OrgContext): Promise<TreasuryWatchedAddressRecord[]>;
  getWatchedAddress(context: OrgContext, id: string): Promise<TreasuryWatchedAddressRecord | null>;
  insertWatchedAddress(record: TreasuryWatchedAddressRecord): Promise<void>;
  updateWatchedAddress(
    context: OrgContext,
    id: string,
    patch: TreasuryWatchedAddressPatch,
  ): Promise<TreasuryWatchedAddressRecord>;

  listBudgets(context: OrgContext): Promise<TreasuryBudgetRecord[]>;
  getBudget(context: OrgContext, id: string): Promise<TreasuryBudgetRecord | null>;
  insertBudget(record: TreasuryBudgetRecord): Promise<void>;
  updateBudget(
    context: OrgContext,
    id: string,
    patch: Partial<
      Pick<
        TreasuryBudgetRecord,
        | "title"
        | "periodStart"
        | "periodEnd"
        | "plannedAmountMicros"
        | "status"
        | "isPublic"
        | "notes"
      >
    >,
  ): Promise<TreasuryBudgetRecord>;

  listFundingNeeds(context: OrgContext): Promise<TreasuryFundingNeedRecord[]>;
  getFundingNeed(context: OrgContext, id: string): Promise<TreasuryFundingNeedRecord | null>;
  insertFundingNeed(record: TreasuryFundingNeedRecord): Promise<void>;
  updateFundingNeed(
    context: OrgContext,
    id: string,
    patch: Partial<
      Pick<
        TreasuryFundingNeedRecord,
        "title" | "publicExplanation" | "requiredAmountMicros" | "status" | "isPublic" | "budgetId"
      >
    >,
  ): Promise<TreasuryFundingNeedRecord>;

  listIdealBudgets(context: OrgContext): Promise<TreasuryIdealBudgetRecord[]>;
  getIdealBudget(context: OrgContext, id: string): Promise<TreasuryIdealBudgetRecord | null>;
  findActivePublicIdeal(
    context: OrgContext,
    periodYear: number,
  ): Promise<TreasuryIdealBudgetRecord | null>;
  insertIdealBudget(record: TreasuryIdealBudgetRecord): Promise<void>;
  updateIdealBudget(
    context: OrgContext,
    id: string,
    patch: Partial<
      Pick<TreasuryIdealBudgetRecord, "status" | "publicationState" | "approvedByUserId">
    >,
  ): Promise<TreasuryIdealBudgetRecord>;

  listRunwayPlans(context: OrgContext): Promise<TreasuryRunwayPlanRecord[]>;
  getRunwayPlan(context: OrgContext, id: string): Promise<TreasuryRunwayPlanRecord | null>;
  insertRunwayPlan(record: TreasuryRunwayPlanRecord): Promise<void>;
  updateRunwayPlan(
    context: OrgContext,
    id: string,
    patch: Partial<Pick<TreasuryRunwayPlanRecord, "status" | "approvedByUserId" | "effectiveTo">>,
  ): Promise<TreasuryRunwayPlanRecord>;

  getPublicationSettings(context: OrgContext): Promise<TreasuryPublicationSettingsRecord | null>;
  upsertPublicationSettings(record: TreasuryPublicationSettingsRecord): Promise<void>;

  listEvidenceObjects(context: OrgContext): Promise<TreasuryEvidenceObjectRecord[]>;
  getEvidenceObject(context: OrgContext, id: string): Promise<TreasuryEvidenceObjectRecord | null>;
  insertEvidenceObject(record: TreasuryEvidenceObjectRecord): Promise<void>;
  updateEvidenceVisibility(
    context: OrgContext,
    id: string,
    visibility: TreasuryEvidenceObjectRecord["visibility"],
  ): Promise<TreasuryEvidenceObjectRecord>;

  listOrgAttributions(context: OrgContext): Promise<TreasuryAdminAttribution[]>;
  getAttribution(context: OrgContext, id: string): Promise<TreasuryAdminAttribution | null>;
  insertAdminAttribution(record: TreasuryAdminAttribution): Promise<void>;
  updateAdminAttribution(
    context: OrgContext,
    id: string,
    patch: Partial<
      Pick<
        TreasuryAdminAttribution,
        | "status"
        | "contributorUserId"
        | "consentPublicIdentity"
        | "note"
        | "revokedAt"
        | "attributedAt"
        | "attributedByUserId"
      >
    >,
  ): Promise<TreasuryAdminAttribution>;
};
