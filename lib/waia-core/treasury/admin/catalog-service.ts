import {
  treasuryBudgetStatusEnum,
  treasuryFundingNeedStatusEnum,
  treasuryAttributionStatusEnum,
  treasuryAddressDirectionScopeEnum,
  treasuryEvidenceVisibilityEnum,
} from "@/db/core-enums";
import type { AuditLogInput } from "@/lib/waia-core/types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { treasuryAuditActions, treasuryEntityTypes } from "@/lib/waia-core/treasury/audit";
import type { TreasuryCatalogRepository } from "@/lib/waia-core/treasury/admin/catalog-repository.types";
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
import { TreasuryNotFoundError, TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import { assertPositiveMicros } from "@/lib/waia-core/treasury/money";
import type { TreasuryRepository } from "@/lib/waia-core/treasury/repository.types";
import type {
  TreasuryActorContext,
  TreasuryEvidenceLinkRecord,
} from "@/lib/waia-core/treasury/types";
import type { TreasuryWatchedAddressRecord } from "@/lib/waia-core/treasury/watcher/types";

function assertEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TreasuryValidationError("INVALID_ENUM", `${label} is not a permitted value`);
  }
  return value as T;
}

export function createTreasuryCatalogService(deps: {
  catalog: TreasuryCatalogRepository;
  treasury: TreasuryRepository;
  writeAudit: (input: AuditLogInput) => string | Promise<string>;
  now?: () => Date;
  newId?: () => string;
}) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());

  async function audit(
    actor: TreasuryActorContext,
    action: string,
    entityType: string,
    entityId: string,
    organizationId: string,
    reason: string,
    extra?: Record<string, unknown>,
  ) {
    await deps.writeAudit({
      actorType: actor.actorType,
      actorId: actor.actorUserId,
      action,
      entityType,
      entityId,
      organizationId,
      metadata: { reason, ...extra },
    });
  }

  return {
    async listWatchedAddresses(context: OrgContext) {
      return deps.catalog.listWatchedAddresses(requireOrgContext(context.organizationId));
    },
    async createWatchedAddress(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: {
        network: string;
        address: string;
        tokenContract: string;
        assetCode: string;
        directionScope: string;
        includeInBalanceRecon: boolean;
        label: string;
        reason: string;
      },
    ): Promise<TreasuryWatchedAddressRecord> {
      const scoped = requireOrgContext(context.organizationId);
      const record: TreasuryWatchedAddressRecord = {
        id: newId(),
        organizationId: scoped.organizationId,
        network: input.network,
        address: input.address,
        tokenContract: input.tokenContract,
        assetCode: input.assetCode,
        directionScope: assertEnum(
          input.directionScope,
          treasuryAddressDirectionScopeEnum,
          "direction_scope",
        ),
        includeInBalanceRecon: input.includeInBalanceRecon,
        label: input.label,
        isActive: true,
        createdAt: now(),
        updatedAt: now(),
      };
      await deps.catalog.insertWatchedAddress(record);
      await audit(
        actor,
        treasuryAuditActions.watchedAddressCreate,
        treasuryEntityTypes.watchedAddress,
        record.id,
        scoped.organizationId,
        input.reason,
      );
      return record;
    },
    async updateWatchedAddress(
      context: OrgContext,
      actor: TreasuryActorContext,
      id: string,
      patch: TreasuryWatchedAddressPatch,
      reason: string,
    ) {
      const scoped = requireOrgContext(context.organizationId);
      if (patch.directionScope) {
        patch.directionScope = assertEnum(
          patch.directionScope,
          treasuryAddressDirectionScopeEnum,
          "direction_scope",
        );
      }
      const updated = await deps.catalog.updateWatchedAddress(scoped, id, patch);
      await audit(
        actor,
        treasuryAuditActions.watchedAddressUpdate,
        treasuryEntityTypes.watchedAddress,
        id,
        scoped.organizationId,
        reason,
        { patch },
      );
      return updated;
    },

    async listBudgets(context: OrgContext) {
      return deps.catalog.listBudgets(requireOrgContext(context.organizationId));
    },
    async createBudget(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: Omit<
        TreasuryBudgetRecord,
        "id" | "organizationId" | "createdAt" | "updatedAt" | "isPublic"
      > & {
        isPublic?: boolean;
        reason: string;
      },
    ) {
      const scoped = requireOrgContext(context.organizationId);
      if (input.isPublic) {
        throw new TreasuryValidationError(
          "PUBLISH_REQUIRED",
          "creating a public budget requires a later publish command",
        );
      }
      const record: TreasuryBudgetRecord = {
        id: newId(),
        organizationId: scoped.organizationId,
        code: input.code,
        title: input.title,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        currency: input.currency,
        plannedAmountMicros: assertPositiveMicros(input.plannedAmountMicros, "plannedAmountMicros"),
        status: assertEnum(input.status, treasuryBudgetStatusEnum, "status"),
        isPublic: false,
        notes: input.notes,
        createdAt: now(),
        updatedAt: now(),
      };
      await deps.catalog.insertBudget(record);
      await audit(
        actor,
        treasuryAuditActions.budgetCreate,
        treasuryEntityTypes.budget,
        record.id,
        scoped.organizationId,
        input.reason,
      );
      return record;
    },
    async updateBudget(
      context: OrgContext,
      actor: TreasuryActorContext,
      id: string,
      patch: Partial<TreasuryBudgetRecord>,
      reason: string,
      permission: "mutate" | "publish",
    ) {
      const scoped = requireOrgContext(context.organizationId);
      if (patch.isPublic !== undefined && permission !== "publish") {
        throw new TreasuryValidationError(
          "PUBLISH_REQUIRED",
          "is_public requires admin.treasury.publish",
        );
      }
      if (patch.status) patch.status = assertEnum(patch.status, treasuryBudgetStatusEnum, "status");
      if (patch.plannedAmountMicros !== undefined) {
        patch.plannedAmountMicros = assertPositiveMicros(
          patch.plannedAmountMicros,
          "plannedAmountMicros",
        );
      }
      const updated = await deps.catalog.updateBudget(scoped, id, patch);
      await audit(
        actor,
        treasuryAuditActions.budgetUpdate,
        treasuryEntityTypes.budget,
        id,
        scoped.organizationId,
        reason,
        { patch },
      );
      return updated;
    },

    async listFundingNeeds(context: OrgContext) {
      return deps.catalog.listFundingNeeds(requireOrgContext(context.organizationId));
    },
    async createFundingNeed(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: Omit<
        TreasuryFundingNeedRecord,
        "id" | "organizationId" | "createdAt" | "updatedAt" | "isPublic"
      > & {
        isPublic?: boolean;
        reason: string;
      },
    ) {
      if (input.isPublic) {
        throw new TreasuryValidationError(
          "PUBLISH_REQUIRED",
          "creating a public funding need requires a later publish command",
        );
      }
      const scoped = requireOrgContext(context.organizationId);
      if (input.budgetId) {
        const budget = await deps.catalog.getBudget(scoped, input.budgetId);
        if (!budget || budget.organizationId !== scoped.organizationId) {
          throw new TreasuryValidationError("CROSS_ORG_REFERENCE", "budget must be same org");
        }
      }
      const record: TreasuryFundingNeedRecord = {
        id: newId(),
        organizationId: scoped.organizationId,
        title: input.title,
        publicExplanation: input.publicExplanation,
        targetStage: input.targetStage,
        requiredAmountMicros: assertPositiveMicros(
          input.requiredAmountMicros,
          "requiredAmountMicros",
        ),
        currency: input.currency,
        status: assertEnum(input.status, treasuryFundingNeedStatusEnum, "status"),
        isPublic: false,
        budgetId: input.budgetId,
        createdAt: now(),
        updatedAt: now(),
      };
      await deps.catalog.insertFundingNeed(record);
      await audit(
        actor,
        treasuryAuditActions.fundingNeedCreate,
        treasuryEntityTypes.fundingNeed,
        record.id,
        scoped.organizationId,
        input.reason,
      );
      return record;
    },
    async updateFundingNeed(
      context: OrgContext,
      actor: TreasuryActorContext,
      id: string,
      patch: Partial<TreasuryFundingNeedRecord>,
      reason: string,
      permission: "mutate" | "publish",
    ) {
      const scoped = requireOrgContext(context.organizationId);
      if (
        (patch.isPublic !== undefined || patch.publicExplanation !== undefined) &&
        permission !== "publish" &&
        patch.isPublic
      ) {
        throw new TreasuryValidationError(
          "PUBLISH_REQUIRED",
          "public funding-need visibility requires publish",
        );
      }
      if (patch.isPublic !== undefined && permission !== "publish") {
        throw new TreasuryValidationError(
          "PUBLISH_REQUIRED",
          "is_public requires admin.treasury.publish",
        );
      }
      if (patch.status)
        patch.status = assertEnum(patch.status, treasuryFundingNeedStatusEnum, "status");
      if (patch.requiredAmountMicros !== undefined) {
        patch.requiredAmountMicros = assertPositiveMicros(
          patch.requiredAmountMicros,
          "requiredAmountMicros",
        );
      }
      if (patch.budgetId) {
        const budget = await deps.catalog.getBudget(scoped, patch.budgetId);
        if (!budget || budget.organizationId !== scoped.organizationId) {
          throw new TreasuryValidationError("CROSS_ORG_REFERENCE", "budget must be same org");
        }
      }
      const updated = await deps.catalog.updateFundingNeed(scoped, id, patch);
      await audit(
        actor,
        treasuryAuditActions.fundingNeedUpdate,
        treasuryEntityTypes.fundingNeed,
        id,
        scoped.organizationId,
        reason,
        { patch },
      );
      return updated;
    },

    async listIdealBudgets(context: OrgContext) {
      return deps.catalog.listIdealBudgets(requireOrgContext(context.organizationId));
    },
    async createIdealBudget(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: {
        periodYear: number;
        currency: string;
        amountMicros: bigint;
        reason: string;
      },
    ) {
      const scoped = requireOrgContext(context.organizationId);
      if (!actor.actorUserId) {
        throw new TreasuryValidationError("ACTOR_REQUIRED", "ideal budget requires admin actor");
      }
      const record: TreasuryIdealBudgetRecord = {
        id: newId(),
        organizationId: scoped.organizationId,
        periodYear: input.periodYear,
        currency: input.currency,
        amountMicros: assertPositiveMicros(input.amountMicros, "amountMicros"),
        effectiveFrom: now(),
        effectiveTo: null,
        status: "DRAFT",
        publicationState: "PRIVATE",
        createdByUserId: actor.actorUserId,
        approvedByUserId: null,
        createdAt: now(),
      };
      await deps.catalog.insertIdealBudget(record);
      await audit(
        actor,
        treasuryAuditActions.idealBudgetCreate,
        treasuryEntityTypes.idealBudget,
        record.id,
        scoped.organizationId,
        input.reason,
      );
      return record;
    },
    async activatePublicIdealBudget(
      context: OrgContext,
      actor: TreasuryActorContext,
      id: string,
      reason: string,
    ) {
      const scoped = requireOrgContext(context.organizationId);
      const current = await deps.catalog.getIdealBudget(scoped, id);
      if (!current)
        throw new TreasuryValidationError("TREASURY_NOT_FOUND", "ideal budget not found");
      const existing = await deps.catalog.findActivePublicIdeal(scoped, current.periodYear);
      if (existing && existing.id !== id) {
        throw new TreasuryValidationError(
          "IDEAL_BUDGET_ACTIVE_PUBLIC_EXISTS",
          "at most one ACTIVE+PUBLIC ideal budget per organization/year",
        );
      }
      const updated = await deps.catalog.updateIdealBudget(scoped, id, {
        status: "ACTIVE",
        publicationState: "PUBLIC",
        approvedByUserId: actor.actorUserId ?? null,
      });
      await audit(
        actor,
        treasuryAuditActions.idealBudgetPublish,
        treasuryEntityTypes.idealBudget,
        id,
        scoped.organizationId,
        reason,
      );
      return updated;
    },

    async listRunwayPlans(context: OrgContext) {
      return deps.catalog.listRunwayPlans(requireOrgContext(context.organizationId));
    },
    async createRunwayDraft(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: { currency: string; dailyBurnMicros: bigint; reason: string },
    ) {
      const scoped = requireOrgContext(context.organizationId);
      if (!actor.actorUserId) {
        throw new TreasuryValidationError("ACTOR_REQUIRED", "runway plan requires admin actor");
      }
      const record: TreasuryRunwayPlanRecord = {
        id: newId(),
        organizationId: scoped.organizationId,
        method: "APPROVED_PLANNED_BURN",
        currency: input.currency,
        dailyBurnMicros: assertPositiveMicros(input.dailyBurnMicros, "dailyBurnMicros"),
        effectiveFrom: now(),
        effectiveTo: null,
        status: "DRAFT",
        createdByUserId: actor.actorUserId,
        approvedByUserId: null,
        createdAt: now(),
      };
      await deps.catalog.insertRunwayPlan(record);
      await audit(
        actor,
        treasuryAuditActions.runwayPlanCreate,
        treasuryEntityTypes.runwayPlan,
        record.id,
        scoped.organizationId,
        input.reason,
      );
      return record;
    },
    async activateRunwayPlan(
      context: OrgContext,
      actor: TreasuryActorContext,
      id: string,
      reason: string,
    ) {
      const scoped = requireOrgContext(context.organizationId);
      const updated = await deps.catalog.updateRunwayPlan(scoped, id, {
        status: "ACTIVE",
        approvedByUserId: actor.actorUserId ?? null,
      });
      await audit(
        actor,
        treasuryAuditActions.runwayPlanActivate,
        treasuryEntityTypes.runwayPlan,
        id,
        scoped.organizationId,
        reason,
      );
      return updated;
    },

    async getSettings(context: OrgContext) {
      return deps.catalog.getPublicationSettings(requireOrgContext(context.organizationId));
    },
    async updateSettings(
      context: OrgContext,
      actor: TreasuryActorContext,
      patch: Partial<TreasuryPublicationSettingsRecord> & { reason: string },
      permission: "mutate" | "publish",
    ) {
      const scoped = requireOrgContext(context.organizationId);
      if (patch.breathEnabled !== undefined && permission !== "publish") {
        throw new TreasuryValidationError(
          "PUBLISH_REQUIRED",
          "breath_enabled requires admin.treasury.publish",
        );
      }
      const existing = await deps.catalog.getPublicationSettings(scoped);
      const record: TreasuryPublicationSettingsRecord = {
        organizationId: scoped.organizationId,
        breathEnabled: patch.breathEnabled ?? existing?.breathEnabled ?? false,
        stageLabel:
          patch.stageLabel !== undefined ? patch.stageLabel : (existing?.stageLabel ?? null),
        workSummary:
          patch.workSummary !== undefined ? patch.workSummary : (existing?.workSummary ?? null),
        methodologyNote: patch.methodologyNote ?? existing?.methodologyNote ?? "",
        recentActivityLimit: patch.recentActivityLimit ?? existing?.recentActivityLimit ?? 5,
        updatedByUserId: actor.actorUserId ?? null,
        updatedAt: now(),
      };
      await deps.catalog.upsertPublicationSettings(record);
      await audit(
        actor,
        treasuryAuditActions.settingsUpdate,
        treasuryEntityTypes.settings,
        scoped.organizationId,
        scoped.organizationId,
        patch.reason,
        { patch },
      );
      return record;
    },

    async listAttributions(context: OrgContext) {
      return deps.catalog.listOrgAttributions(requireOrgContext(context.organizationId));
    },
    async createAttribution(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: {
        transactionId: string;
        status: string;
        contributorUserId?: string | null;
        consentPublicIdentity?: boolean;
        note?: string | null;
        reason: string;
      },
    ) {
      const scoped = requireOrgContext(context.organizationId);
      if (input.consentPublicIdentity === true) {
        throw new TreasuryValidationError(
          "CONTRIBUTOR_IDENTITY_NOT_PUBLIC",
          "WP-4 does not make contributor identity public",
        );
      }
      const tx = await deps.treasury.getTransaction(scoped, input.transactionId);
      if (!tx || tx.organizationId !== scoped.organizationId) {
        throw new TreasuryNotFoundError("transaction", input.transactionId);
      }
      const record: TreasuryAdminAttribution = {
        id: newId(),
        organizationId: scoped.organizationId,
        transactionId: input.transactionId,
        status: assertEnum(input.status, treasuryAttributionStatusEnum, "status"),
        contributorUserId: input.contributorUserId ?? null,
        attributionMethod: "ADMIN",
        consentPublicIdentity: false,
        note: input.note ?? null,
        attributedByUserId: actor.actorUserId ?? null,
        attributedAt: now(),
        revokedAt: input.status === "REVOKED" ? now() : null,
        createdAt: now(),
      };
      await deps.catalog.insertAdminAttribution(record);
      await audit(
        actor,
        treasuryAuditActions.attributionCreate,
        treasuryEntityTypes.attribution,
        record.id,
        scoped.organizationId,
        input.reason,
      );
      return record;
    },

    async listEvidence(context: OrgContext) {
      return deps.catalog.listEvidenceObjects(requireOrgContext(context.organizationId));
    },
    async getEvidence(context: OrgContext, id: string) {
      return deps.catalog.getEvidenceObject(requireOrgContext(context.organizationId), id);
    },
    async setEvidenceVisibility(
      context: OrgContext,
      actor: TreasuryActorContext,
      id: string,
      visibility: string,
      reason: string,
    ): Promise<TreasuryEvidenceObjectRecord> {
      const scoped = requireOrgContext(context.organizationId);
      const next = assertEnum(visibility, treasuryEvidenceVisibilityEnum, "visibility");
      const updated = await deps.catalog.updateEvidenceVisibility(scoped, id, next);
      await audit(
        actor,
        treasuryAuditActions.evidenceVisibility,
        treasuryEntityTypes.evidence,
        id,
        scoped.organizationId,
        reason,
        { visibility: next },
      );
      return updated;
    },
    refuseCreateEvidenceObject(): never {
      throw new TreasuryValidationError(
        "EVIDENCE_STORAGE_NOT_CONFIGURED",
        "Evidence object storage is not configured",
      );
    },
    async registerEvidenceObject(
      actor: TreasuryActorContext,
      record: TreasuryEvidenceObjectRecord,
      reason: string,
    ): Promise<TreasuryEvidenceObjectRecord> {
      await deps.catalog.insertEvidenceObject(record);
      await audit(
        actor,
        treasuryAuditActions.evidenceUpload,
        treasuryEntityTypes.evidence,
        record.id,
        record.organizationId,
        reason,
        {
          kind: record.kind,
          visibility: record.visibility,
          objectKey: record.objectKey,
          sha256: record.sha256,
          storageBackend: record.storageBackend,
        },
      );
      return record;
    },
    async linkEvidence(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: { transactionId: string; evidenceObjectId: string; reason: string },
    ): Promise<TreasuryEvidenceLinkRecord> {
      const scoped = requireOrgContext(context.organizationId);
      const tx = await deps.treasury.getTransaction(scoped, input.transactionId);
      if (!tx || tx.organizationId !== scoped.organizationId) {
        throw new TreasuryNotFoundError("transaction", input.transactionId);
      }
      const evidence = await deps.catalog.getEvidenceObject(scoped, input.evidenceObjectId);
      if (!evidence || evidence.organizationId !== scoped.organizationId) {
        throw new TreasuryNotFoundError("evidence", input.evidenceObjectId);
      }
      const record: TreasuryEvidenceLinkRecord = {
        id: newId(),
        organizationId: scoped.organizationId,
        transactionId: tx.id,
        evidenceObjectId: evidence.id,
      };
      await deps.treasury.insertEvidenceLink(record);
      await audit(
        actor,
        treasuryAuditActions.evidenceLink,
        treasuryEntityTypes.evidence,
        evidence.id,
        scoped.organizationId,
        input.reason,
        { transactionId: tx.id, linkId: record.id },
      );
      return record;
    },
    async unlinkEvidence(
      context: OrgContext,
      actor: TreasuryActorContext,
      input: { linkId: string; reason: string },
    ): Promise<void> {
      const scoped = requireOrgContext(context.organizationId);
      await deps.treasury.deleteEvidenceLink(scoped, input.linkId);
      await audit(
        actor,
        treasuryAuditActions.evidenceUnlink,
        treasuryEntityTypes.evidence,
        input.linkId,
        scoped.organizationId,
        input.reason,
      );
    },
  };
}

export type TreasuryCatalogService = ReturnType<typeof createTreasuryCatalogService>;
