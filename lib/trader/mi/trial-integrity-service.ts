import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import {
  MiTrialIntegrityInputValidationError,
  MiTrialIntegritySeqConflictError,
  MiTrialNotFoundError,
  PitViolationError,
} from "@/lib/trader/mi/errors";
import { buildTrialIntegrityContentDigest } from "@/lib/trader/mi/serialize-trial-integrity";
import {
  createPostgresMiTrialIntegrityRepository,
  createSqliteMiTrialIntegrityRepository,
} from "@/lib/trader/mi/trial-integrity-repository-adapters";
import {
  deriveTrialIntegrityState,
  isMiTrialIntegrityReasonCode,
  MI_TRIAL_INTEGRITY_SCHEMA_VERSION,
  type MiTrialIntegrityEvent,
  type MiTrialIntegrityState,
} from "@/lib/trader/mi/trial-integrity.types";
import {
  createPostgresMiTrialRepository,
  createSqliteMiTrialRepository,
} from "@/lib/trader/mi/trial-repository-adapters";
import type {
  InvalidateTrialServiceInput,
  MiTrialIntegrityRepository,
  MiTrialIntegrityServiceDeps,
  MiTrialRepository,
} from "@/lib/trader/mi/types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgMiTrialIntegrityServiceExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

const MAX_SEQ_RETRIES = 5;

export type MiTrialIntegrityService = {
  invalidateTrial: (
    context: OrgContext,
    input: InvalidateTrialServiceInput,
  ) => Promise<MiTrialIntegrityEvent>;
  getTrialIntegrity: (
    context: OrgContext,
    trialId: string,
  ) => Promise<MiTrialIntegrityState | null>;
  listTrialIntegrityEvents: (
    context: OrgContext,
    trialId: string,
  ) => Promise<MiTrialIntegrityEvent[]>;
};

export type MiTrialIntegrityServiceBundle = {
  trialIntegrity: MiTrialIntegrityService;
  trialIntegrityRepository: MiTrialIntegrityRepository;
};

async function assertMembershipIfNeeded(
  context: OrgContext,
  assertMembership: MiTrialIntegrityServiceDeps["assertMembership"],
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
    action: traderAuditActions.miTrialIntegrityInvalidated,
    entityType: traderEntityTypes.miTrialIntegrity,
    entityId,
    organizationId: context.organizationId,
    metadata,
  };
}

function assertPit(eventTime: Date, ingestTime: Date): void {
  if (ingestTime.getTime() < eventTime.getTime()) {
    throw new PitViolationError(
      "MI_TRIAL_INTEGRITY_PIT_INVALID: ingest_time must be >= event_time",
    );
  }
}

function normalizeCauseRef(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new MiTrialIntegrityInputValidationError(
      "MI_TRIAL_INTEGRITY_INPUT_INVALID: causeRef must be a string when provided",
    );
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function assertInvalidateInput(input: InvalidateTrialServiceInput): {
  rationale: string;
  causeRef: string | null;
} {
  if (!input.trialId?.trim()) {
    throw new MiTrialIntegrityInputValidationError(
      "MI_TRIAL_INTEGRITY_INPUT_INVALID: trialId is required and must be non-empty",
    );
  }
  if (!input.reasonCode || !isMiTrialIntegrityReasonCode(input.reasonCode)) {
    throw new MiTrialIntegrityInputValidationError(
      "MI_TRIAL_INTEGRITY_INPUT_INVALID: reasonCode must be a closed taxonomy value",
    );
  }
  if (!input.rationale?.trim()) {
    throw new MiTrialIntegrityInputValidationError(
      "MI_TRIAL_INTEGRITY_INPUT_INVALID: rationale is required and must be non-empty",
    );
  }
  if (!input.recordedBy?.trim()) {
    throw new MiTrialIntegrityInputValidationError(
      "MI_TRIAL_INTEGRITY_INPUT_INVALID: recordedBy is required and must be non-empty",
    );
  }
  return {
    rationale: input.rationale.trim(),
    causeRef: normalizeCauseRef(input.causeRef),
  };
}

function isSeqUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("trader_mi_trial_integrity_event_org_trial_seq_unique") ||
    (msg.includes("unique constraint failed") && msg.includes("trader_mi_trial_integrity_event"))
  );
}

function createService(
  integrityRepo: MiTrialIntegrityRepository,
  trialRepo: MiTrialRepository,
  deps: MiTrialIntegrityServiceDeps,
  writeAudit: (input: TraderAuditInput) => Promise<string> | string,
): MiTrialIntegrityService {
  return {
    async invalidateTrial(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const { rationale, causeRef } = assertInvalidateInput(input);
      assertPit(input.eventTime, input.ingestTime);

      const trial = await trialRepo.findTrialById(scoped, input.trialId);
      if (!trial) {
        throw new MiTrialNotFoundError(
          "MI_TRIAL_NOT_FOUND: trial must exist within organization scope before invalidation",
        );
      }

      const contentDigest = buildTrialIntegrityContentDigest({
        organizationId: scoped.organizationId,
        trialId: input.trialId,
        eventType: "invalidated",
        reasonCode: input.reasonCode,
        rationale,
        causeRef,
        eventTime: input.eventTime,
        ingestTime: input.ingestTime,
        recordedBy: input.recordedBy,
      });

      const now = new Date();
      for (let attempt = 0; attempt < MAX_SEQ_RETRIES; attempt++) {
        const latest = await integrityRepo.getLatestEvent(scoped, input.trialId);
        const seq = (latest?.seq ?? 0) + 1;
        const id = crypto.randomUUID();

        try {
          const event = await integrityRepo.insertEvent(scoped, {
            id,
            trialId: input.trialId,
            eventType: "invalidated",
            reasonCode: input.reasonCode,
            rationale,
            causeRef,
            schemaVersion: MI_TRIAL_INTEGRITY_SCHEMA_VERSION,
            eventTime: input.eventTime,
            ingestTime: input.ingestTime,
            recordedBy: input.recordedBy,
            seq,
            contentDigest,
            createdAt: now,
          });

          writeAudit(
            buildAuditInput(
              scoped,
              event.id,
              {
                trialId: event.trialId,
                eventType: event.eventType,
                reasonCode: event.reasonCode,
                rationale: event.rationale,
                causeRef: event.causeRef,
                seq: event.seq,
                contentDigest: event.contentDigest,
              },
              input.actorType ?? deps.actorType ?? "service",
              input.actorId ?? deps.actorId ?? null,
            ),
          );

          return event;
        } catch (err) {
          if (isSeqUniqueViolation(err)) {
            continue;
          }
          throw err;
        }
      }

      throw new MiTrialIntegritySeqConflictError(
        `MI_TRIAL_INTEGRITY_SEQ_CONFLICT: failed to allocate seq after ${MAX_SEQ_RETRIES} retries`,
      );
    },

    async getTrialIntegrity(context, trialId) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const trial = await trialRepo.findTrialById(scoped, trialId);
      if (!trial) return null;

      const events = await integrityRepo.listEvents(scoped, trialId);
      return deriveTrialIntegrityState(events);
    },

    async listTrialIntegrityEvents(context, trialId) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const trial = await trialRepo.findTrialById(scoped, trialId);
      if (!trial) {
        throw new MiTrialNotFoundError(
          "MI_TRIAL_NOT_FOUND: trial must exist within organization scope",
        );
      }

      return integrityRepo.listEvents(scoped, trialId);
    },
  };
}

export function createSqliteMiTrialIntegrityService(
  db: WaiaDb,
  deps: MiTrialIntegrityServiceDeps = {},
): MiTrialIntegrityServiceBundle {
  const trialIntegrityRepository = createSqliteMiTrialIntegrityRepository(db);
  const trialRepository = createSqliteMiTrialRepository(db);
  const trialIntegrity = createService(trialIntegrityRepository, trialRepository, deps, (input) =>
    writeTraderAuditLogSqlite(db, input),
  );
  return { trialIntegrity, trialIntegrityRepository };
}

export function createPostgresMiTrialIntegrityService(
  ex: PgMiTrialIntegrityServiceExecutor,
  deps: MiTrialIntegrityServiceDeps = {},
): MiTrialIntegrityServiceBundle {
  const trialIntegrityRepository = createPostgresMiTrialIntegrityRepository(ex);
  const trialRepository = createPostgresMiTrialRepository(ex);
  const trialIntegrity = createService(trialIntegrityRepository, trialRepository, deps, (input) =>
    writeTraderAuditLogPostgres(ex, input),
  );
  return { trialIntegrity, trialIntegrityRepository };
}

export function createSqliteMiTrialIntegrityServiceWithMembership(
  db: WaiaDb,
  deps: MiTrialIntegrityServiceDeps = {},
): MiTrialIntegrityServiceBundle {
  return createSqliteMiTrialIntegrityService(db, {
    ...deps,
    assertMembership: deps.assertMembership
      ? deps.assertMembership
      : (context) => assertOrgMembershipSqlite(db, context),
  });
}

export function createPostgresMiTrialIntegrityServiceWithMembership(
  ex: PgMiTrialIntegrityServiceExecutor,
  deps: MiTrialIntegrityServiceDeps = {},
): MiTrialIntegrityServiceBundle {
  return createPostgresMiTrialIntegrityService(ex, {
    ...deps,
    assertMembership: deps.assertMembership
      ? deps.assertMembership
      : (context) => assertOrgMembershipPostgres(ex, context),
  });
}
