import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import {
  MiHypothesisNotFoundError,
  MiTrialInputValidationError,
  MiTrialRefError,
  MiTrialSeqConflictError,
  PitViolationError,
} from "@/lib/trader/mi/errors";
import {
  createPostgresMiHypothesisRepository,
  createSqliteMiHypothesisRepository,
} from "@/lib/trader/mi/hypothesis-repository-adapters";
import type { HypothesisDefinition } from "@/lib/trader/mi/hypothesis.types";
import { buildTrialContentDigest } from "@/lib/trader/mi/serialize-trial";
import {
  createPostgresMiTrialRepository,
  createSqliteMiTrialRepository,
} from "@/lib/trader/mi/trial-repository-adapters";
import {
  type MiTrial,
  type MiTrialCounts,
  type MiTrialIntegrityStatus,
  type MiTrialPinnedClaim,
} from "@/lib/trader/mi/trial.types";
import type {
  MiHypothesisRepository,
  MiTrialRepository,
  MiTrialServiceDeps,
  RegisterTrialServiceInput,
} from "@/lib/trader/mi/types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgMiTrialServiceExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

const MAX_SEQ_RETRIES = 5;

export type MiTrialService = {
  registerTrial: (context: OrgContext, input: RegisterTrialServiceInput) => Promise<MiTrial>;
  listTrials: (context: OrgContext, hypothesisKey: string) => Promise<MiTrial[]>;
  listTrialsByHypothesisId: (context: OrgContext, hypothesisId: string) => Promise<MiTrial[]>;
  getTrialById: (context: OrgContext, trialId: string) => Promise<MiTrial | null>;
  getTrialCounts: (
    context: OrgContext,
    hypothesisKey: string,
    hypothesisId: string,
  ) => Promise<MiTrialCounts>;
  /** Derived integrity (LD-5a.2b / R2) — constant `valid` for an existing trial, else null. */
  getTrialIntegrity: (
    context: OrgContext,
    trialId: string,
  ) => Promise<MiTrialIntegrityStatus | null>;
  /** Read-time resolution of nulls/falsification from the pinned hypothesis (LD-5a.2b / R1). */
  getTrialPinnedClaim: (context: OrgContext, trialId: string) => Promise<MiTrialPinnedClaim | null>;
};

export type MiTrialServiceBundle = {
  trial: MiTrialService;
  trialRepository: MiTrialRepository;
};

async function assertMembershipIfNeeded(
  context: OrgContext,
  assertMembership: MiTrialServiceDeps["assertMembership"],
): Promise<void> {
  if (context.userId && assertMembership) {
    await assertMembership({ organizationId: context.organizationId, userId: context.userId });
  }
}

function buildAuditInput(
  context: OrgContext,
  entityId: string,
  metadata: Record<string, unknown>,
  actorType: TraderAuditInput["actorType"] = "service",
  actorId: string | null = null,
): TraderAuditInput {
  return {
    actorType,
    actorId,
    action: traderAuditActions.miTrialRegistered,
    entityType: traderEntityTypes.miTrial,
    entityId,
    organizationId: context.organizationId,
    metadata,
  };
}

function assertPit(eventTime: Date, ingestTime: Date): void {
  if (ingestTime.getTime() < eventTime.getTime()) {
    throw new PitViolationError("MI_TRIAL_PIT_INVALID: ingest_time must be >= event_time");
  }
}

function normalizeResearchProgram(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new MiTrialInputValidationError(
      "MI_TRIAL_INPUT_INVALID: researchProgram must be a string when provided",
    );
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function assertClosedInput(input: RegisterTrialServiceInput): { researchProgram: string | null } {
  if (!input.hypothesisId?.trim()) {
    throw new MiTrialInputValidationError(
      "MI_TRIAL_INPUT_INVALID: hypothesisId is required and must be non-empty",
    );
  }
  if (!input.hypothesisDefinitionDigest?.trim()) {
    throw new MiTrialInputValidationError(
      "MI_TRIAL_INPUT_INVALID: hypothesisDefinitionDigest is required and must be non-empty",
    );
  }
  if (!input.registeredBy?.trim()) {
    throw new MiTrialInputValidationError(
      "MI_TRIAL_INPUT_INVALID: registeredBy is required and must be non-empty",
    );
  }
  return { researchProgram: normalizeResearchProgram(input.researchProgram) };
}

async function assertHypothesisPin(
  context: OrgContext,
  hypothesisRepo: MiHypothesisRepository,
  hypothesisId: string,
  hypothesisDefinitionDigest: string,
): Promise<{ hypothesisKey: string }> {
  const hypothesis = await hypothesisRepo.findHypothesisById(context, hypothesisId);
  if (!hypothesis) {
    throw new MiHypothesisNotFoundError(
      "MI_HYPOTHESIS_NOT_FOUND: hypothesis pin does not resolve within organization scope",
    );
  }
  if (hypothesis.definitionDigest !== hypothesisDefinitionDigest) {
    throw new MiTrialRefError(
      "MI_TRIAL_REF_INVALID: hypothesisDefinitionDigest does not match pinned hypothesis version",
    );
  }
  return { hypothesisKey: hypothesis.hypothesisKey };
}

function isSeqUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("trader_mi_trial_org_key_seq_unique") ||
    (msg.includes("unique constraint failed") && msg.includes("trader_mi_trial"))
  );
}

function createService(
  trialRepo: MiTrialRepository,
  hypothesisRepo: MiHypothesisRepository,
  deps: MiTrialServiceDeps,
  writeAudit: (input: TraderAuditInput) => Promise<string> | string,
): MiTrialService {
  return {
    async registerTrial(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const { researchProgram } = assertClosedInput(input);
      assertPit(input.eventTime, input.ingestTime);

      const { hypothesisKey } = await assertHypothesisPin(
        scoped,
        hypothesisRepo,
        input.hypothesisId,
        input.hypothesisDefinitionDigest,
      );

      const contentDigest = buildTrialContentDigest({
        organizationId: scoped.organizationId,
        hypothesisKey,
        hypothesisId: input.hypothesisId,
        hypothesisDefinitionDigest: input.hypothesisDefinitionDigest,
        researchProgram,
        eventTime: input.eventTime,
        ingestTime: input.ingestTime,
        registeredBy: input.registeredBy,
      });

      const now = new Date();
      for (let attempt = 0; attempt < MAX_SEQ_RETRIES; attempt++) {
        const latest = await trialRepo.getLatestTrial(scoped, hypothesisKey);
        const seq = (latest?.seq ?? 0) + 1;
        const id = crypto.randomUUID();

        try {
          const trial = await trialRepo.insertTrial(scoped, {
            id,
            hypothesisId: input.hypothesisId,
            hypothesisKey,
            hypothesisDefinitionDigest: input.hypothesisDefinitionDigest,
            researchProgram,
            eventTime: input.eventTime,
            ingestTime: input.ingestTime,
            registeredBy: input.registeredBy,
            seq,
            contentDigest,
            createdAt: now,
          });

          writeAudit(
            buildAuditInput(
              scoped,
              trial.id,
              {
                hypothesisKey: trial.hypothesisKey,
                hypothesisId: trial.hypothesisId,
                hypothesisDefinitionDigest: trial.hypothesisDefinitionDigest,
                researchProgram: trial.researchProgram,
                seq: trial.seq,
                contentDigest: trial.contentDigest,
              },
              input.actorType ?? deps.actorType ?? "service",
              input.actorId ?? deps.actorId ?? null,
            ),
          );

          return trial;
        } catch (err) {
          if (isSeqUniqueViolation(err)) {
            continue;
          }
          throw err;
        }
      }

      throw new MiTrialSeqConflictError(
        `MI_TRIAL_SEQ_CONFLICT: failed to allocate seq after ${MAX_SEQ_RETRIES} retries`,
      );
    },

    async listTrials(context, hypothesisKey) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return trialRepo.listTrials(scoped, hypothesisKey);
    },

    async listTrialsByHypothesisId(context, hypothesisId) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return trialRepo.listTrialsByHypothesisId(scoped, hypothesisId);
    },

    async getTrialById(context, trialId) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return trialRepo.findTrialById(scoped, trialId);
    },

    async getTrialCounts(context, hypothesisKey, hypothesisId) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      const byKey = await trialRepo.listTrials(scoped, hypothesisKey);
      const byId = await trialRepo.listTrialsByHypothesisId(scoped, hypothesisId);
      const latestSeq = byKey.length > 0 ? byKey[byKey.length - 1].seq : null;
      return {
        byHypothesisKey: byKey.length,
        byHypothesisId: byId.length,
        latestSeq,
      };
    },

    async getTrialIntegrity(context, trialId) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      const trial = await trialRepo.findTrialById(scoped, trialId);
      if (!trial) return null;
      // R2: derived from the append-only log. No invalidation events exist in this slice,
      // so every persisted trial derives `valid`. LD-5a.2c replaces this with a
      // ledger-backed derivation.
      return "valid";
    },

    async getTrialPinnedClaim(context, trialId) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      const trial = await trialRepo.findTrialById(scoped, trialId);
      if (!trial) return null;

      const hypothesis = await hypothesisRepo.findHypothesisById(scoped, trial.hypothesisId);
      if (!hypothesis || hypothesis.definitionDigest !== trial.hypothesisDefinitionDigest) {
        throw new MiTrialRefError(
          "MI_TRIAL_REF_INVALID: pinned hypothesis version no longer resolves for trial",
        );
      }

      const definition = JSON.parse(hypothesis.definitionJson) as HypothesisDefinition;
      return {
        requiredNulls: definition.requiredNulls,
        falsificationConditions: definition.falsificationConditions,
      };
    },
  };
}

export function createSqliteMiTrialService(
  db: WaiaDb,
  deps: MiTrialServiceDeps = {},
): MiTrialServiceBundle {
  const trialRepository = createSqliteMiTrialRepository(db);
  const hypothesisRepository = createSqliteMiHypothesisRepository(db);
  const trial = createService(trialRepository, hypothesisRepository, deps, (input) =>
    writeTraderAuditLogSqlite(db, input),
  );
  return { trial, trialRepository };
}

export function createPostgresMiTrialService(
  ex: PgMiTrialServiceExecutor,
  deps: MiTrialServiceDeps = {},
): MiTrialServiceBundle {
  const trialRepository = createPostgresMiTrialRepository(ex);
  const hypothesisRepository = createPostgresMiHypothesisRepository(ex);
  const trial = createService(trialRepository, hypothesisRepository, deps, (input) =>
    writeTraderAuditLogPostgres(ex, input),
  );
  return { trial, trialRepository };
}

export function createSqliteMiTrialServiceWithMembership(
  db: WaiaDb,
  deps: MiTrialServiceDeps = {},
): MiTrialServiceBundle {
  return createSqliteMiTrialService(db, {
    ...deps,
    assertMembership: deps.assertMembership
      ? deps.assertMembership
      : (context) => assertOrgMembershipSqlite(db, context),
  });
}

export function createPostgresMiTrialServiceWithMembership(
  ex: PgMiTrialServiceExecutor,
  deps: MiTrialServiceDeps = {},
): MiTrialServiceBundle {
  return createPostgresMiTrialService(ex, {
    ...deps,
    assertMembership: deps.assertMembership
      ? deps.assertMembership
      : (context) => assertOrgMembershipPostgres(ex, context),
  });
}
