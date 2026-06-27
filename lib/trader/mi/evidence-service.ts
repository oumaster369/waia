import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import {
  MiEvidenceInputValidationError,
  MiEvidenceRefError,
  MiEvidenceSeqConflictError,
  MiHypothesisNotFoundError,
  PitViolationError,
} from "@/lib/trader/mi/errors";
import {
  createPostgresMiEvidenceRepository,
  createSqliteMiEvidenceRepository,
} from "@/lib/trader/mi/evidence-repository-adapters";
import {
  miEvidenceDirectionValues,
  miEvidenceKindValues,
  type MiEvidence,
  type MiEvidenceDirection,
  type MiEvidenceKind,
  type MiEvidenceMeasurementRef,
  type MiEvidenceObservationRef,
  type MiEvidenceSummary,
} from "@/lib/trader/mi/evidence.types";
import {
  createPostgresMiHypothesisRepository,
  createSqliteMiHypothesisRepository,
} from "@/lib/trader/mi/hypothesis-repository-adapters";
import {
  createPostgresMiMeasurementRepository,
  createSqliteMiMeasurementRepository,
} from "@/lib/trader/mi/measurement-repository-adapters";
import {
  createPostgresMiObservationRepository,
  createSqliteMiObservationRepository,
} from "@/lib/trader/mi/observation-repository-adapters";
import {
  createPostgresMiTrialRepository,
  createSqliteMiTrialRepository,
} from "@/lib/trader/mi/trial-repository-adapters";
import {
  buildEvidenceContentDigest,
  serializeMeasurementRefsJson,
  serializeObservationRefsJson,
} from "@/lib/trader/mi/serialize-evidence";
import type {
  MiEvidenceRepository,
  MiEvidenceServiceDeps,
  MiHypothesisRepository,
  MiMeasurementRepository,
  MiObservationRepository,
  MiTrialRepository,
  RecordEvidenceServiceInput,
} from "@/lib/trader/mi/types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgMiEvidenceServiceExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

const EVIDENCE_DIRECTION_SET = new Set<string>(miEvidenceDirectionValues);
const EVIDENCE_KIND_SET = new Set<string>(miEvidenceKindValues);
const MAX_SEQ_RETRIES = 5;

export type MiEvidenceService = {
  recordEvidence: (context: OrgContext, input: RecordEvidenceServiceInput) => Promise<MiEvidence>;
  listEvidence: (context: OrgContext, hypothesisKey: string) => Promise<MiEvidence[]>;
  getEvidenceById: (context: OrgContext, evidenceId: string) => Promise<MiEvidence | null>;
  listEvidenceByDirection: (
    context: OrgContext,
    hypothesisKey: string,
    direction: MiEvidenceDirection,
  ) => Promise<MiEvidence[]>;
  getEvidenceSummary: (context: OrgContext, hypothesisKey: string) => Promise<MiEvidenceSummary>;
};

export type MiEvidenceServiceBundle = {
  evidence: MiEvidenceService;
  evidenceRepository: MiEvidenceRepository;
};

async function assertMembershipIfNeeded(
  context: OrgContext,
  assertMembership: MiEvidenceServiceDeps["assertMembership"],
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
    action: traderAuditActions.miEvidenceRecorded,
    entityType: traderEntityTypes.miEvidence,
    entityId,
    organizationId: context.organizationId,
    metadata,
  };
}

function assertPit(eventTime: Date, ingestTime: Date): void {
  if (ingestTime.getTime() < eventTime.getTime()) {
    throw new PitViolationError("MI_EVIDENCE_PIT_INVALID: ingest_time must be >= event_time");
  }
}

function assertClosedInput(input: RecordEvidenceServiceInput): {
  evidenceKind: MiEvidenceKind;
  direction: MiEvidenceDirection;
  measurementRefs: MiEvidenceMeasurementRef[];
  observationRefs: MiEvidenceObservationRef[];
} {
  const evidenceKind = input.evidenceKind ?? "observed";
  if (!EVIDENCE_KIND_SET.has(evidenceKind)) {
    throw new MiEvidenceInputValidationError(
      `MI_EVIDENCE_INPUT_INVALID: unknown evidenceKind '${evidenceKind}'`,
    );
  }
  if (!EVIDENCE_DIRECTION_SET.has(input.direction)) {
    throw new MiEvidenceInputValidationError(
      `MI_EVIDENCE_INPUT_INVALID: unknown direction '${input.direction}'`,
    );
  }
  if (!input.recordedBy?.trim()) {
    throw new MiEvidenceInputValidationError(
      "MI_EVIDENCE_INPUT_INVALID: recordedBy is required and must be non-empty",
    );
  }
  if (!Array.isArray(input.measurementRefs) || input.measurementRefs.length === 0) {
    throw new MiEvidenceInputValidationError(
      "MI_EVIDENCE_INPUT_INVALID: at least one measurementRef is required",
    );
  }
  if (!Array.isArray(input.observationRefs) || input.observationRefs.length === 0) {
    throw new MiEvidenceInputValidationError(
      "MI_EVIDENCE_INPUT_INVALID: at least one observationRef is required",
    );
  }
  for (const ref of input.measurementRefs) {
    if (!ref?.measurementKey || !ref?.measurementDefinitionDigest) {
      throw new MiEvidenceInputValidationError(
        "MI_EVIDENCE_INPUT_INVALID: measurementKey and measurementDefinitionDigest are required",
      );
    }
  }
  for (const ref of input.observationRefs) {
    if (!ref?.observationId) {
      throw new MiEvidenceInputValidationError(
        "MI_EVIDENCE_INPUT_INVALID: observationId is required for each observationRef",
      );
    }
  }
  return {
    evidenceKind: evidenceKind as MiEvidenceKind,
    direction: input.direction,
    measurementRefs: [...input.measurementRefs],
    observationRefs: [...input.observationRefs],
  };
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
    throw new MiEvidenceRefError(
      "MI_EVIDENCE_REF_INVALID: hypothesisDefinitionDigest does not match pinned hypothesis version",
    );
  }
  return { hypothesisKey: hypothesis.hypothesisKey };
}

async function assertMeasurementPins(
  context: OrgContext,
  measurementRepo: MiMeasurementRepository,
  measurementRefs: readonly MiEvidenceMeasurementRef[],
): Promise<void> {
  for (const ref of measurementRefs) {
    const measurement = await measurementRepo.findMeasurementByDigest(
      context,
      ref.measurementDefinitionDigest,
    );
    if (!measurement || measurement.measurementKey !== ref.measurementKey) {
      throw new MiEvidenceRefError(
        `MI_EVIDENCE_REF_INVALID: no measurement version matches key '${ref.measurementKey}' with the pinned digest`,
      );
    }
  }
}

async function assertObservationPins(
  context: OrgContext,
  observationRepo: MiObservationRepository,
  observationRefs: readonly MiEvidenceObservationRef[],
): Promise<void> {
  for (const ref of observationRefs) {
    const observation = await observationRepo.findObservationById(context, ref.observationId);
    if (!observation) {
      throw new MiEvidenceRefError(
        `MI_EVIDENCE_REF_INVALID: observation '${ref.observationId}' does not resolve within organization scope`,
      );
    }
  }
}

function normalizeTrialRegistrationRef(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

async function assertTrialPin(
  context: OrgContext,
  trialRepo: MiTrialRepository,
  trialRegistrationRef: string | null,
): Promise<void> {
  if (trialRegistrationRef === null) return;
  const trial = await trialRepo.findTrialById(context, trialRegistrationRef);
  if (!trial) {
    throw new MiEvidenceRefError(
      `MI_EVIDENCE_REF_INVALID: trial '${trialRegistrationRef}' does not resolve within organization scope`,
    );
  }
}

function isSeqUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("trader_mi_evidence_org_key_seq_unique") ||
    (msg.includes("unique constraint failed") && msg.includes("trader_mi_evidence"))
  );
}

function createService(
  evidenceRepo: MiEvidenceRepository,
  hypothesisRepo: MiHypothesisRepository,
  measurementRepo: MiMeasurementRepository,
  observationRepo: MiObservationRepository,
  trialRepo: MiTrialRepository,
  deps: MiEvidenceServiceDeps,
  writeAudit: (input: TraderAuditInput) => Promise<string> | string,
): MiEvidenceService {
  return {
    async recordEvidence(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const parsed = assertClosedInput(input);
      assertPit(input.eventTime, input.ingestTime);

      const { hypothesisKey } = await assertHypothesisPin(
        scoped,
        hypothesisRepo,
        input.hypothesisId,
        input.hypothesisDefinitionDigest,
      );
      await assertMeasurementPins(scoped, measurementRepo, parsed.measurementRefs);
      await assertObservationPins(scoped, observationRepo, parsed.observationRefs);

      const trialRegistrationRef = normalizeTrialRegistrationRef(input.trialRegistrationRef);
      await assertTrialPin(scoped, trialRepo, trialRegistrationRef);

      const measurementRefsJson = serializeMeasurementRefsJson(parsed.measurementRefs);
      const observationRefsJson = serializeObservationRefsJson(parsed.observationRefs);
      const contentDigest = buildEvidenceContentDigest({
        organizationId: scoped.organizationId,
        evidenceKind: parsed.evidenceKind,
        direction: parsed.direction,
        hypothesisKey,
        hypothesisDefinitionDigest: input.hypothesisDefinitionDigest,
        measurementRefs: parsed.measurementRefs,
        observationRefs: parsed.observationRefs,
        eventTime: input.eventTime,
        ingestTime: input.ingestTime,
        recordedBy: input.recordedBy,
        nullComparatorRef: null,
        regimeContextRef: null,
        trialRegistrationRef,
      });

      const now = new Date();
      for (let attempt = 0; attempt < MAX_SEQ_RETRIES; attempt++) {
        const latest = await evidenceRepo.getLatestEvidence(scoped, hypothesisKey);
        const seq = (latest?.seq ?? 0) + 1;
        const id = crypto.randomUUID();

        try {
          const evidence = await evidenceRepo.insertEvidence(scoped, {
            id,
            evidenceKind: parsed.evidenceKind,
            direction: parsed.direction,
            hypothesisId: input.hypothesisId,
            hypothesisKey,
            hypothesisDefinitionDigest: input.hypothesisDefinitionDigest,
            measurementRefsJson,
            observationRefsJson,
            eventTime: input.eventTime,
            ingestTime: input.ingestTime,
            recordedBy: input.recordedBy,
            seq,
            contentDigest,
            nullComparatorRef: null,
            regimeContextRef: null,
            trialRegistrationRef,
            createdAt: now,
          });

          writeAudit(
            buildAuditInput(
              scoped,
              evidence.id,
              {
                hypothesisKey: evidence.hypothesisKey,
                hypothesisId: evidence.hypothesisId,
                hypothesisDefinitionDigest: evidence.hypothesisDefinitionDigest,
                direction: evidence.direction,
                evidenceKind: evidence.evidenceKind,
                seq: evidence.seq,
                measurementRefsCount: parsed.measurementRefs.length,
                observationRefsCount: parsed.observationRefs.length,
                trialRegistrationRef: evidence.trialRegistrationRef,
                contentDigest: evidence.contentDigest,
              },
              input.actorType ?? deps.actorType ?? "service",
              input.actorId ?? deps.actorId ?? null,
            ),
          );

          return evidence;
        } catch (err) {
          if (isSeqUniqueViolation(err)) {
            continue;
          }
          throw err;
        }
      }

      throw new MiEvidenceSeqConflictError(
        `MI_EVIDENCE_SEQ_CONFLICT: failed to allocate seq after ${MAX_SEQ_RETRIES} retries`,
      );
    },

    async listEvidence(context, hypothesisKey) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return evidenceRepo.listEvidence(scoped, hypothesisKey);
    },

    async getEvidenceById(context, evidenceId) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return evidenceRepo.findEvidenceById(scoped, evidenceId);
    },

    async listEvidenceByDirection(context, hypothesisKey, direction) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      if (!EVIDENCE_DIRECTION_SET.has(direction)) {
        throw new MiEvidenceInputValidationError(
          `MI_EVIDENCE_INPUT_INVALID: unknown direction '${direction}'`,
        );
      }
      return evidenceRepo.listEvidenceByDirection(scoped, hypothesisKey, direction);
    },

    async getEvidenceSummary(context, hypothesisKey) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      const rows = await evidenceRepo.listEvidence(scoped, hypothesisKey);
      let forCount = 0;
      let againstCount = 0;
      let neutralCount = 0;
      let latestSeq: number | null = null;

      for (const row of rows) {
        if (row.direction === "FOR") forCount++;
        else if (row.direction === "AGAINST") againstCount++;
        else neutralCount++;
        latestSeq = row.seq;
      }

      return { forCount, againstCount, neutralCount, latestSeq };
    },
  };
}

export function createSqliteMiEvidenceService(
  db: WaiaDb,
  deps: MiEvidenceServiceDeps = {},
): MiEvidenceServiceBundle {
  const evidenceRepository = createSqliteMiEvidenceRepository(db);
  const hypothesisRepository = createSqliteMiHypothesisRepository(db);
  const measurementRepository = createSqliteMiMeasurementRepository(db);
  const observationRepository = createSqliteMiObservationRepository(db);
  const trialRepository = createSqliteMiTrialRepository(db);
  const evidence = createService(
    evidenceRepository,
    hypothesisRepository,
    measurementRepository,
    observationRepository,
    trialRepository,
    deps,
    (input) => writeTraderAuditLogSqlite(db, input),
  );
  return { evidence, evidenceRepository };
}

export function createPostgresMiEvidenceService(
  ex: PgMiEvidenceServiceExecutor,
  deps: MiEvidenceServiceDeps = {},
): MiEvidenceServiceBundle {
  const evidenceRepository = createPostgresMiEvidenceRepository(ex);
  const hypothesisRepository = createPostgresMiHypothesisRepository(ex);
  const measurementRepository = createPostgresMiMeasurementRepository(ex);
  const observationRepository = createPostgresMiObservationRepository(ex);
  const trialRepository = createPostgresMiTrialRepository(ex);
  const evidence = createService(
    evidenceRepository,
    hypothesisRepository,
    measurementRepository,
    observationRepository,
    trialRepository,
    deps,
    (input) => writeTraderAuditLogPostgres(ex, input),
  );
  return { evidence, evidenceRepository };
}

export function createSqliteMiEvidenceServiceWithMembership(
  db: WaiaDb,
  deps: MiEvidenceServiceDeps = {},
): MiEvidenceServiceBundle {
  return createSqliteMiEvidenceService(db, {
    ...deps,
    assertMembership: deps.assertMembership
      ? deps.assertMembership
      : (context) => assertOrgMembershipSqlite(db, context),
  });
}

export function createPostgresMiEvidenceServiceWithMembership(
  ex: PgMiEvidenceServiceExecutor,
  deps: MiEvidenceServiceDeps = {},
): MiEvidenceServiceBundle {
  return createPostgresMiEvidenceService(ex, {
    ...deps,
    assertMembership: deps.assertMembership
      ? deps.assertMembership
      : (context) => assertOrgMembershipPostgres(ex, context),
  });
}
