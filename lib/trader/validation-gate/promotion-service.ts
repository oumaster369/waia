import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeAuditLogPostgres, writeAuditLogSqlite } from "@/lib/waia-core/audit/write";
import { ResearchEvidenceProvenanceError } from "@/lib/trader/research/errors";
import { validateResearchEvidenceProvenancePostgres } from "@/lib/trader/research/validate-research-evidence-provenance";
import { assembleStrategyPromotionRecord } from "@/lib/trader/validation-gate/assemble-strategy-promotion-record";
import type { AssembleStrategyPromotionRecordInput } from "@/lib/trader/validation-gate/strategy-promotion-record.types";
import { effectivePromotionCoolingOffMs } from "@/lib/trader/validation-gate/config";
import {
  findPromotionByIdempotencyKeyPostgres,
  getEffectivePromotionPostgres,
  getLatestPendingPromotionPostgres,
  getPromotionRecordByIdPostgres,
  insertPromotionRecordPostgres,
  updatePromotionGovernancePostgres,
} from "@/lib/trader/validation-gate/repository-postgres";
import {
  findPromotionByIdempotencyKeySqlite,
  getEffectivePromotionSqlite,
  getLatestPendingPromotionSqlite,
  getPromotionRecordByIdSqlite,
  insertPromotionRecordSqlite,
  updatePromotionGovernanceSqlite,
} from "@/lib/trader/validation-gate/repository-sqlite";
import {
  StrategyPromotionConcurrencyError,
  StrategyPromotionConflictError,
  StrategyPromotionCoolingOffNotElapsedError,
  StrategyPromotionNotFoundError,
  StrategyPromotionValidationError,
} from "@/lib/trader/validation-gate/strategy-promotion-record.errors";
import type {
  InsertPromotionRecordInput,
  PromotionActor,
  PromotionGovernancePatch,
  PromotionPreview,
  PromotionTransitionInput,
  RequestPromotionInput,
  StrategyLiveAuthorizationInput,
  StrategyPromotionRecordView,
} from "@/lib/trader/validation-gate/strategy-promotion-record.types";
import { assertAllowedPromotionTransition } from "@/lib/trader/validation-gate/transitions";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

type PgPromotionExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export type StrategyPromotionRepository = {
  insert(input: InsertPromotionRecordInput): Promise<StrategyPromotionRecordView>;
  getById(context: OrgContext, recordId: string): Promise<StrategyPromotionRecordView | null>;
  findByIdempotencyKey(
    context: OrgContext,
    idempotencyKey: string,
  ): Promise<StrategyPromotionRecordView | null>;
  getEffective(
    context: OrgContext,
    strategyId: string,
  ): Promise<StrategyPromotionRecordView | null>;
  getLatestPending(
    context: OrgContext,
    strategyId: string,
  ): Promise<StrategyPromotionRecordView | null>;
  updateGovernance(
    context: OrgContext,
    recordId: string,
    expectedStateVersion: number,
    patch: PromotionGovernancePatch,
  ): Promise<StrategyPromotionRecordView>;
};

export type StrategyPromotionServiceDeps = {
  repository: StrategyPromotionRepository;
  nowMs: () => number;
  writeAudit: (
    actor: PromotionActor,
    organizationId: string,
    action: string,
    record: StrategyPromotionRecordView,
    metadata?: Record<string, unknown>,
  ) => Promise<string> | string;
  /** Postgres-only: cross-check research evidence artifact IDs before assembly. */
  validateAssembly?: (
    context: OrgContext,
    assembly: AssembleStrategyPromotionRecordInput,
  ) => Promise<void>;
};

function validateCoolingOffMsOverride(value: number | undefined): number {
  if (value === undefined) {
    return effectivePromotionCoolingOffMs(undefined);
  }
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new StrategyPromotionValidationError("STRATEGY_PROMOTION_COOLING_OFF_MS_INVALID");
  }
  return value;
}

function assertNoEffectivePromotion(
  existing: StrategyPromotionRecordView | null,
  strategyId: string,
): void {
  if (existing && existing.strategyId === strategyId) {
    throw new StrategyPromotionConflictError(
      "STRATEGY_PROMOTION_EFFECTIVE_ALREADY_EXISTS",
      `Effective promotion already exists for strategy ${strategyId}`,
    );
  }
}

function mapRepositoryError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message === "STRATEGY_PROMOTION_STATE_VERSION_MISMATCH") {
      throw new StrategyPromotionConcurrencyError();
    }
    if (error.message === "STRATEGY_PROMOTION_NOT_FOUND") {
      throw new StrategyPromotionNotFoundError();
    }
  }
  throw error;
}

export function buildPromotionPreview(
  record: StrategyPromotionRecordView,
  nowMs: number,
): PromotionPreview {
  const coolingOffMs = effectivePromotionCoolingOffMs(undefined);
  const eligibleAt = record.coolingOffEndsAt;
  const remainingMs = eligibleAt ? Math.max(0, eligibleAt.getTime() - nowMs) : 0;

  return {
    record,
    coolingOffMs,
    eligibleAt,
    remainingMs,
    confirmable: record.state === "PENDING_CONFIRM",
    effectiveEligible: record.state === "COOLING_OFF" && remainingMs === 0,
  };
}

function mapResearchProvenanceError(error: unknown): never {
  if (error instanceof ResearchEvidenceProvenanceError) {
    throw new StrategyPromotionValidationError(error.code);
  }
  throw error;
}

export function createStrategyPromotionService(deps: StrategyPromotionServiceDeps) {
  const { repository, nowMs, writeAudit, validateAssembly } = deps;

  async function getRecord(
    context: OrgContext,
    recordId: string,
  ): Promise<StrategyPromotionRecordView> {
    const record = await repository.getById(context, recordId);
    if (!record) {
      throw new StrategyPromotionNotFoundError();
    }
    return record;
  }

  async function updateGovernance(
    context: OrgContext,
    recordId: string,
    expectedStateVersion: number,
    patch: PromotionGovernancePatch,
  ): Promise<StrategyPromotionRecordView> {
    try {
      return await repository.updateGovernance(context, recordId, expectedStateVersion, patch);
    } catch (error) {
      mapRepositoryError(error);
    }
  }

  return {
    async requestPromotion(
      actor: PromotionActor,
      context: OrgContext,
      input: RequestPromotionInput,
    ): Promise<StrategyPromotionRecordView> {
      const scoped = requireOrgContext(context.organizationId);

      if (validateAssembly) {
        try {
          await validateAssembly(scoped, input.assembly);
        } catch (error) {
          mapResearchProvenanceError(error);
        }
      }

      const payload = assembleStrategyPromotionRecord(input.assembly);

      if (payload.organizationId !== scoped.organizationId) {
        throw new StrategyPromotionValidationError("STRATEGY_PROMOTION_ORG_MISMATCH");
      }

      if (input.idempotencyKey) {
        const existing = await repository.findByIdempotencyKey(scoped, input.idempotencyKey);
        if (existing) {
          return existing;
        }
      }

      const effective = await repository.getEffective(scoped, payload.strategyId);
      assertNoEffectivePromotion(effective, payload.strategyId);

      const now = new Date(nowMs());
      const record = await repository.insert({
        ...payload,
        id: crypto.randomUUID(),
        state: "PENDING_CONFIRM",
        actorId: actor.actorId,
        requestedAt: now,
        idempotencyKey: input.idempotencyKey ?? null,
      });

      await writeAudit(
        actor,
        scoped.organizationId,
        traderAuditActions.promotionRequested,
        record,
        {
          strategyId: record.strategyId,
          strategyVersion: record.strategyVersion,
        },
      );

      return record;
    },

    async previewPromotion(context: OrgContext, recordId: string): Promise<PromotionPreview> {
      const record = await getRecord(context, recordId);
      return buildPromotionPreview(record, nowMs());
    },

    async confirmPromotion(
      actor: PromotionActor,
      context: OrgContext,
      recordId: string,
      input: PromotionTransitionInput,
    ): Promise<StrategyPromotionRecordView> {
      const scoped = requireOrgContext(context.organizationId);
      const existing = await getRecord(scoped, recordId);
      assertAllowedPromotionTransition(existing.state, "COOLING_OFF");

      const effective = await repository.getEffective(scoped, existing.strategyId);
      assertNoEffectivePromotion(effective, existing.strategyId);

      const coolingOffMs = validateCoolingOffMsOverride(input.coolingOffMs);
      const now = new Date(nowMs());
      const coolingOffEndsAt = new Date(now.getTime() + coolingOffMs);

      const updated = await updateGovernance(scoped, recordId, input.expectedStateVersion, {
        state: "COOLING_OFF",
        confirmedAt: now,
        coolingOffEndsAt,
        stateVersion: existing.stateVersion + 1,
        updatedAt: now,
      });

      await writeAudit(
        actor,
        scoped.organizationId,
        traderAuditActions.promotionConfirmed,
        updated,
        {
          coolingOffMs,
          coolingOffEndsAt: coolingOffEndsAt.toISOString(),
        },
      );

      return updated;
    },

    async markEffective(
      actor: PromotionActor,
      context: OrgContext,
      recordId: string,
      input: PromotionTransitionInput,
    ): Promise<StrategyPromotionRecordView> {
      const scoped = requireOrgContext(context.organizationId);
      const existing = await getRecord(scoped, recordId);
      assertAllowedPromotionTransition(existing.state, "EFFECTIVE");

      const now = nowMs();
      const preview = buildPromotionPreview(existing, now);
      if (!preview.effectiveEligible) {
        throw new StrategyPromotionCoolingOffNotElapsedError();
      }

      const effective = await repository.getEffective(scoped, existing.strategyId);
      assertNoEffectivePromotion(effective, existing.strategyId);

      const effectiveAt = new Date(now);
      const updated = await updateGovernance(scoped, recordId, input.expectedStateVersion, {
        state: "EFFECTIVE",
        effectiveAt,
        stateVersion: existing.stateVersion + 1,
        updatedAt: effectiveAt,
      });

      await writeAudit(
        actor,
        scoped.organizationId,
        traderAuditActions.promotionEffective,
        updated,
        {
          effectiveAt: effectiveAt.toISOString(),
        },
      );

      return updated;
    },

    async cancelPromotion(
      actor: PromotionActor,
      context: OrgContext,
      recordId: string,
      input: PromotionTransitionInput,
    ): Promise<StrategyPromotionRecordView> {
      const scoped = requireOrgContext(context.organizationId);
      const existing = await getRecord(scoped, recordId);
      if (existing.state !== "PENDING_CONFIRM" && existing.state !== "COOLING_OFF") {
        throw new StrategyPromotionValidationError("STRATEGY_PROMOTION_CANCEL_NOT_ALLOWED");
      }

      const now = new Date(nowMs());
      const updated = await updateGovernance(scoped, recordId, input.expectedStateVersion, {
        state: "CANCELLED",
        cancelledAt: now,
        stateVersion: existing.stateVersion + 1,
        updatedAt: now,
      });

      await writeAudit(
        actor,
        scoped.organizationId,
        traderAuditActions.promotionCancelled,
        updated,
      );

      return updated;
    },

    async demoteStrategy(
      actor: PromotionActor,
      context: OrgContext,
      strategyId: string,
      input: PromotionTransitionInput,
    ): Promise<StrategyPromotionRecordView> {
      const scoped = requireOrgContext(context.organizationId);
      const existing = await repository.getEffective(scoped, strategyId);
      if (!existing) {
        throw new StrategyPromotionNotFoundError();
      }

      const now = new Date(nowMs());
      const updated = await updateGovernance(scoped, existing.id, input.expectedStateVersion, {
        state: "REVOKED",
        revokedAt: now,
        stateVersion: existing.stateVersion + 1,
        updatedAt: now,
      });

      await writeAudit(actor, scoped.organizationId, traderAuditActions.promotionDemoted, updated, {
        reason: input.reason ?? null,
      });

      return updated;
    },

    async getEffectivePromotion(
      context: OrgContext,
      strategyId: string,
    ): Promise<StrategyPromotionRecordView | null> {
      return repository.getEffective(requireOrgContext(context.organizationId), strategyId);
    },

    async isLiveAuthorized(
      context: OrgContext,
      input: StrategyLiveAuthorizationInput,
    ): Promise<boolean> {
      const record = await repository.getEffective(
        requireOrgContext(context.organizationId),
        input.strategyId,
      );
      if (!record) {
        return false;
      }
      return record.strategyVersion === input.strategyVersion;
    },
  };
}

export type StrategyPromotionService = ReturnType<typeof createStrategyPromotionService>;

export function createSqliteStrategyPromotionRepository(db: WaiaDb): StrategyPromotionRepository {
  return {
    insert: async (input) => insertPromotionRecordSqlite(db, input),
    getById: async (context, recordId) => getPromotionRecordByIdSqlite(db, context, recordId),
    findByIdempotencyKey: async (context, key) =>
      findPromotionByIdempotencyKeySqlite(db, context, key),
    getEffective: async (context, strategyId) =>
      getEffectivePromotionSqlite(db, context, strategyId),
    getLatestPending: async (context, strategyId) =>
      getLatestPendingPromotionSqlite(db, context, strategyId),
    updateGovernance: async (context, recordId, expectedStateVersion, patch) =>
      updatePromotionGovernanceSqlite(db, context, recordId, expectedStateVersion, patch),
  };
}

export function createPostgresStrategyPromotionRepository(
  ex: PgPromotionExecutor,
): StrategyPromotionRepository {
  return {
    insert: (input) => insertPromotionRecordPostgres(ex, input),
    getById: (context, recordId) => getPromotionRecordByIdPostgres(ex, context, recordId),
    findByIdempotencyKey: (context, key) => findPromotionByIdempotencyKeyPostgres(ex, context, key),
    getEffective: (context, strategyId) => getEffectivePromotionPostgres(ex, context, strategyId),
    getLatestPending: (context, strategyId) =>
      getLatestPendingPromotionPostgres(ex, context, strategyId),
    updateGovernance: (context, recordId, expectedStateVersion, patch) =>
      updatePromotionGovernancePostgres(ex, context, recordId, expectedStateVersion, patch),
  };
}

export function createSqliteStrategyPromotionService(
  db: WaiaDb,
  deps: { nowMs?: () => number } = {},
): StrategyPromotionService {
  const nowMs = deps.nowMs ?? (() => Date.now());
  return createStrategyPromotionService({
    repository: createSqliteStrategyPromotionRepository(db),
    nowMs,
    writeAudit: (actor, organizationId, action, record, metadata) =>
      writeAuditLogSqlite(db, {
        actorType: actor.actorType,
        actorId: actor.actorId,
        action,
        entityType: traderEntityTypes.strategyPromotion,
        entityId: record.id,
        organizationId,
        metadata: {
          strategyId: record.strategyId,
          strategyVersion: record.strategyVersion,
          state: record.state,
          ...metadata,
        },
      }),
  });
}

export function createPostgresStrategyPromotionService(
  ex: PgPromotionExecutor,
  deps: { nowMs?: () => number; validateResearchProvenance?: boolean } = {},
): StrategyPromotionService {
  const nowMs = deps.nowMs ?? (() => Date.now());
  const validateResearchProvenance = deps.validateResearchProvenance ?? true;
  return createStrategyPromotionService({
    repository: createPostgresStrategyPromotionRepository(ex),
    nowMs,
    validateAssembly: validateResearchProvenance
      ? async (context, assembly) => {
          await validateResearchEvidenceProvenancePostgres(
            ex,
            context,
            assembly.researchEvidenceDocument,
          );
        }
      : undefined,
    writeAudit: async (actor, organizationId, action, record, metadata) =>
      writeAuditLogPostgres(ex, {
        actorType: actor.actorType,
        actorId: actor.actorId,
        action,
        entityType: traderEntityTypes.strategyPromotion,
        entityId: record.id,
        organizationId,
        metadata: {
          strategyId: record.strategyId,
          strategyVersion: record.strategyVersion,
          state: record.state,
          ...metadata,
        },
      }),
  });
}
