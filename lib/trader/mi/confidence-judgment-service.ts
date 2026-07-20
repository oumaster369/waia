import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import {
  assertConfidenceBandOrderingV1,
  deriveConfidenceEligibility,
  deriveConfidenceSignals,
  deriveHypothesisLifecycleStateAsOf,
  deriveTrialIntegrityStateAsOf,
  filterVisibleByIngestTime,
  isMiConfidenceJudgmentKind,
  isMiConfidenceLevelV1,
  MI_CONFIDENCE_DERIVATION_VERSION,
  MI_CONFIDENCE_EXPIRING_SOON_WINDOW_MS,
  MI_CONFIDENCE_JUDGMENT_SCHEMA_VERSION,
  MI_CONFIDENCE_SCALE_V1,
  selectLatestConfidenceJudgmentForVersion,
  type MiConfidenceEligibilityResult,
  type MiConfidenceJudgment,
  type MiConfidenceJudgmentCitation,
  type MiConfidenceSignalsResult,
} from "@/lib/trader/mi/confidence-judgment.types";
import {
  createPostgresMiConfidenceJudgmentRepository,
  createSqliteMiConfidenceJudgmentRepository,
} from "@/lib/trader/mi/confidence-judgment-repository-adapters";
import {
  MiConfidenceJudgmentAuthorizationError,
  MiConfidenceJudgmentInputValidationError,
  MiConfidenceJudgmentRefError,
  MiConfidenceJudgmentSeqConflictError,
  MiHypothesisNotFoundError,
  PitViolationError,
} from "@/lib/trader/mi/errors";
import {
  createPostgresMiEvidenceRepository,
  createSqliteMiEvidenceRepository,
} from "@/lib/trader/mi/evidence-repository-adapters";
import {
  createPostgresMiHypothesisRepository,
  createSqliteMiHypothesisRepository,
} from "@/lib/trader/mi/hypothesis-repository-adapters";
import {
  buildConfidenceJudgmentContentDigest,
  serializeForCitationsJson,
} from "@/lib/trader/mi/serialize-confidence-judgment";
import {
  createPostgresMiTrialIntegrityRepository,
  createSqliteMiTrialIntegrityRepository,
} from "@/lib/trader/mi/trial-integrity-repository-adapters";
import type {
  MiConfidenceJudgmentRepository,
  MiConfidenceJudgmentServiceDeps,
  MiEvidenceRepository,
  MiHypothesisRepository,
  MiTrialIntegrityRepository,
  RecordConfidenceJudgmentServiceInput,
} from "@/lib/trader/mi/types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgMiConfidenceJudgmentServiceExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

const HUMAN_CONFIDENCE_ACTOR_TYPES = new Set(["user", "admin"]);
const MAX_SEQ_RETRIES = 5;

export type MiConfidenceJudgmentService = {
  recordConfidenceJudgment: (
    context: OrgContext,
    input: RecordConfidenceJudgmentServiceInput,
  ) => Promise<MiConfidenceJudgment>;
  getCurrentConfidenceJudgment: (
    context: OrgContext,
    hypothesisId: string,
    asOf?: Date,
  ) => Promise<MiConfidenceJudgment | null>;
  getConfidenceEligibility: (
    context: OrgContext,
    input: { hypothesisId: string; asOf: Date },
  ) => Promise<MiConfidenceEligibilityResult | null>;
  getConfidenceEligibilityForLatestVersion: (
    context: OrgContext,
    input: { hypothesisKey: string; asOf: Date },
  ) => Promise<(MiConfidenceEligibilityResult & { versionSeq: number }) | null>;
  getConfidenceSignals: (
    context: OrgContext,
    input: { hypothesisId: string; asOf: Date },
  ) => Promise<MiConfidenceSignalsResult | null>;
  getConfidenceJudgmentHistory: (
    context: OrgContext,
    hypothesisId: string,
  ) => Promise<MiConfidenceJudgment[]>;
};

export type MiConfidenceJudgmentServiceBundle = {
  confidenceJudgment: MiConfidenceJudgmentService;
  confidenceJudgmentRepository: MiConfidenceJudgmentRepository;
};

async function assertMembershipIfNeeded(
  context: OrgContext,
  assertMembership: MiConfidenceJudgmentServiceDeps["assertMembership"],
): Promise<void> {
  if (context.userId && assertMembership) {
    await assertMembership({ organizationId: context.organizationId, userId: context.userId });
  }
}

function buildAuditInput(
  context: OrgContext,
  entityId: string,
  metadata: Record<string, unknown>,
  actorType: TraderAuditInput["actorType"],
  actorId: string | null,
): TraderAuditInput {
  return {
    actorType,
    actorId,
    action: traderAuditActions.miConfidenceJudgmentRecorded,
    entityType: traderEntityTypes.miConfidenceJudgment,
    entityId,
    organizationId: context.organizationId,
    metadata,
  };
}

function assertPit(eventTime: Date, ingestTime: Date): void {
  if (ingestTime.getTime() < eventTime.getTime()) {
    throw new PitViolationError(
      "MI_CONFIDENCE_JUDGMENT_PIT_INVALID: ingest_time must be >= event_time",
    );
  }
}

function assertHumanConfidenceActor(
  input: RecordConfidenceJudgmentServiceInput,
  deps: MiConfidenceJudgmentServiceDeps,
): { actorType: "user" | "admin"; actorId: string | null } {
  const actorType = input.actorType ?? deps.actorType;
  if (!actorType || !HUMAN_CONFIDENCE_ACTOR_TYPES.has(actorType)) {
    throw new MiConfidenceJudgmentAuthorizationError(
      "MI_CONFIDENCE_JUDGMENT_UNAUTHORIZED: confidence judgments require actorType user or admin",
    );
  }
  if (!input.recordedBy?.trim()) {
    throw new MiConfidenceJudgmentAuthorizationError(
      "MI_CONFIDENCE_JUDGMENT_UNAUTHORIZED: recordedBy is required for confidence judgments",
    );
  }
  return {
    actorType: actorType as "user" | "admin",
    actorId: input.actorId ?? deps.actorId ?? null,
  };
}

function normalizeCitations(
  citations: readonly MiConfidenceJudgmentCitation[] | undefined,
): MiConfidenceJudgmentCitation[] {
  if (!citations) return [];
  return citations.map((citation) => ({
    evidenceId: citation.evidenceId,
    evidenceContentDigest: citation.evidenceContentDigest,
  }));
}

async function assertCitationPins(
  context: OrgContext,
  evidenceRepo: MiEvidenceRepository,
  hypothesisDefinitionDigest: string,
  citations: readonly MiConfidenceJudgmentCitation[],
): Promise<void> {
  for (const citation of citations) {
    const evidence = await evidenceRepo.findEvidenceById(context, citation.evidenceId);
    if (!evidence) {
      throw new MiConfidenceJudgmentRefError(
        "MI_CONFIDENCE_JUDGMENT_REF_INVALID: cited evidence must exist within organization scope",
      );
    }
    if (evidence.direction !== "FOR") {
      throw new MiConfidenceJudgmentRefError(
        "MI_CONFIDENCE_JUDGMENT_REF_INVALID: only FOR-direction evidence may be cited as relied-upon basis",
      );
    }
    if (evidence.hypothesisDefinitionDigest !== hypothesisDefinitionDigest) {
      throw new MiConfidenceJudgmentRefError(
        "MI_CONFIDENCE_JUDGMENT_REF_INVALID: cited evidence must pin the same hypothesis version",
      );
    }
    if (evidence.contentDigest !== citation.evidenceContentDigest) {
      throw new MiConfidenceJudgmentRefError(
        "MI_CONFIDENCE_JUDGMENT_REF_INVALID: evidenceContentDigest must match pinned evidence at authoring",
      );
    }
  }
}

async function resolveCitationIntegrityInvalidated(
  context: OrgContext,
  judgment: MiConfidenceJudgment | null,
  asOf: Date,
  evidenceRepo: MiEvidenceRepository,
  integrityRepo: MiTrialIntegrityRepository,
): Promise<boolean> {
  if (!judgment || judgment.forCitations.length === 0) {
    return false;
  }

  for (const citation of judgment.forCitations) {
    const evidence = await evidenceRepo.findEvidenceById(context, citation.evidenceId);
    if (!evidence?.trialRegistrationRef) {
      continue;
    }
    const events = await integrityRepo.listEvents(context, evidence.trialRegistrationRef);
    const integrity = deriveTrialIntegrityStateAsOf(events, asOf);
    if (integrity.status === "invalidated") {
      return true;
    }
  }
  return false;
}

function isSeqUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("trader_mi_confidence_judgment_org_key_seq_unique") ||
    (msg.includes("unique constraint failed") && msg.includes("trader_mi_confidence_judgment"))
  );
}

function createService(
  judgmentRepo: MiConfidenceJudgmentRepository,
  hypothesisRepo: MiHypothesisRepository,
  evidenceRepo: MiEvidenceRepository,
  integrityRepo: MiTrialIntegrityRepository,
  deps: MiConfidenceJudgmentServiceDeps,
  writeAudit: (input: TraderAuditInput) => Promise<string> | string,
): MiConfidenceJudgmentService {
  async function loadHypothesisOrNull(context: OrgContext, hypothesisId: string) {
    return hypothesisRepo.findHypothesisById(context, hypothesisId);
  }

  async function buildDerivationContext(
    context: OrgContext,
    hypothesisId: string,
    asOf: Date,
  ): Promise<{
    hypothesis: NonNullable<Awaited<ReturnType<typeof loadHypothesisOrNull>>>;
    latestJudgment: MiConfidenceJudgment | null;
    lifecycleState: ReturnType<typeof deriveHypothesisLifecycleStateAsOf>;
    citationIntegrityInvalidated: boolean;
  } | null> {
    const hypothesis = await loadHypothesisOrNull(context, hypothesisId);
    if (!hypothesis) return null;

    const judgments = await judgmentRepo.listJudgmentsForHypothesisId(context, hypothesisId);
    const latestJudgment = selectLatestConfidenceJudgmentForVersion(judgments, hypothesisId, asOf);
    const lifecycleEvents = await hypothesisRepo.listLifecycleEvents(
      context,
      hypothesis.hypothesisKey,
    );
    const lifecycleState = deriveHypothesisLifecycleStateAsOf(lifecycleEvents, asOf);
    const citationIntegrityInvalidated = await resolveCitationIntegrityInvalidated(
      context,
      latestJudgment,
      asOf,
      evidenceRepo,
      integrityRepo,
    );

    return {
      hypothesis,
      latestJudgment,
      lifecycleState,
      citationIntegrityInvalidated,
    };
  }

  return {
    async recordConfidenceJudgment(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      const actor = assertHumanConfidenceActor(input, deps);
      assertPit(input.eventTime, input.ingestTime);

      if (!input.hypothesisId?.trim()) {
        throw new MiConfidenceJudgmentInputValidationError(
          "MI_CONFIDENCE_JUDGMENT_INPUT_INVALID: hypothesisId is required",
        );
      }
      if (!input.hypothesisDefinitionDigest?.trim()) {
        throw new MiConfidenceJudgmentInputValidationError(
          "MI_CONFIDENCE_JUDGMENT_INPUT_INVALID: hypothesisDefinitionDigest is required",
        );
      }
      if (!isMiConfidenceJudgmentKind(input.judgmentKind)) {
        throw new MiConfidenceJudgmentInputValidationError(
          "MI_CONFIDENCE_JUDGMENT_INPUT_INVALID: judgmentKind must be asserted or insufficiency_attested",
        );
      }

      const hypothesis = await hypothesisRepo.findHypothesisById(scoped, input.hypothesisId);
      if (!hypothesis) {
        throw new MiHypothesisNotFoundError(
          "MI_HYPOTHESIS_NOT_FOUND: hypothesis pin does not resolve within organization scope",
        );
      }
      if (hypothesis.definitionDigest !== input.hypothesisDefinitionDigest) {
        throw new MiConfidenceJudgmentRefError(
          "MI_CONFIDENCE_JUDGMENT_REF_INVALID: hypothesisDefinitionDigest does not match pinned hypothesis version",
        );
      }

      const citations = normalizeCitations(input.forCitations);

      let level: MiConfidenceJudgment["level"] = null;
      let bandLow: MiConfidenceJudgment["bandLow"] = null;
      let bandHigh: MiConfidenceJudgment["bandHigh"] = null;
      let confidenceScaleVersion: MiConfidenceJudgment["confidenceScaleVersion"] = null;
      let reviewHorizonAt: Date | null = null;

      if (input.judgmentKind === "asserted") {
        const scaleVersion = input.confidenceScaleVersion ?? MI_CONFIDENCE_SCALE_V1;
        if (scaleVersion !== MI_CONFIDENCE_SCALE_V1) {
          throw new MiConfidenceJudgmentInputValidationError(
            "MI_CONFIDENCE_JUDGMENT_INPUT_INVALID: unsupported confidenceScaleVersion",
          );
        }
        if (
          !input.level ||
          !input.bandLow ||
          !input.bandHigh ||
          !isMiConfidenceLevelV1(input.level) ||
          !isMiConfidenceLevelV1(input.bandLow) ||
          !isMiConfidenceLevelV1(input.bandHigh)
        ) {
          throw new MiConfidenceJudgmentInputValidationError(
            "MI_CONFIDENCE_JUDGMENT_INPUT_INVALID: asserted judgments require mi-confidence-scale-v1 level and band endpoints",
          );
        }
        if (!input.reviewHorizonAt) {
          throw new MiConfidenceJudgmentInputValidationError(
            "MI_CONFIDENCE_JUDGMENT_INPUT_INVALID: asserted judgments require reviewHorizonAt",
          );
        }
        assertConfidenceBandOrderingV1(input.level, input.bandLow, input.bandHigh);
        await assertCitationPins(scoped, evidenceRepo, input.hypothesisDefinitionDigest, citations);
        level = input.level;
        bandLow = input.bandLow;
        bandHigh = input.bandHigh;
        confidenceScaleVersion = MI_CONFIDENCE_SCALE_V1;
        reviewHorizonAt = input.reviewHorizonAt;
      } else if (citations.length > 0) {
        await assertCitationPins(scoped, evidenceRepo, input.hypothesisDefinitionDigest, citations);
      }

      const contentDigest = buildConfidenceJudgmentContentDigest({
        organizationId: scoped.organizationId,
        hypothesisKey: hypothesis.hypothesisKey,
        hypothesisDefinitionDigest: input.hypothesisDefinitionDigest,
        confidenceScaleVersion,
        level,
        bandLow,
        bandHigh,
        judgmentKind: input.judgmentKind,
        reviewHorizonAt,
        forCitations: citations,
        eventTime: input.eventTime,
        ingestTime: input.ingestTime,
        recordedBy: input.recordedBy.trim(),
      });

      const now = new Date();
      for (let attempt = 0; attempt < MAX_SEQ_RETRIES; attempt++) {
        const latest = await judgmentRepo.getLatestJudgmentByKey(scoped, hypothesis.hypothesisKey);
        const seq = (latest?.seq ?? 0) + 1;
        const id = crypto.randomUUID();

        try {
          const judgment = await judgmentRepo.insertJudgment(scoped, {
            id,
            hypothesisId: hypothesis.id,
            hypothesisKey: hypothesis.hypothesisKey,
            hypothesisDefinitionDigest: input.hypothesisDefinitionDigest,
            level,
            bandLow,
            bandHigh,
            confidenceScaleVersion,
            judgmentKind: input.judgmentKind,
            reviewHorizonAt,
            forCitationsJson: serializeForCitationsJson(citations),
            eventTime: input.eventTime,
            ingestTime: input.ingestTime,
            recordedBy: input.recordedBy.trim(),
            seq,
            contentDigest,
            schemaVersion: MI_CONFIDENCE_JUDGMENT_SCHEMA_VERSION,
            createdAt: now,
          });

          writeAudit(
            buildAuditInput(
              scoped,
              judgment.id,
              {
                hypothesisId: judgment.hypothesisId,
                hypothesisKey: judgment.hypothesisKey,
                judgmentKind: judgment.judgmentKind,
                level: judgment.level,
                bandLow: judgment.bandLow,
                bandHigh: judgment.bandHigh,
                seq: judgment.seq,
                contentDigest: judgment.contentDigest,
                derivationVersionId: MI_CONFIDENCE_DERIVATION_VERSION,
              },
              actor.actorType,
              actor.actorId,
            ),
          );

          return judgment;
        } catch (err) {
          if (isSeqUniqueViolation(err)) {
            continue;
          }
          throw err;
        }
      }

      throw new MiConfidenceJudgmentSeqConflictError(
        `MI_CONFIDENCE_JUDGMENT_SEQ_CONFLICT: failed to allocate seq after ${MAX_SEQ_RETRIES} retries`,
      );
    },

    async getCurrentConfidenceJudgment(context, hypothesisId, asOf = new Date()) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      const hypothesis = await loadHypothesisOrNull(scoped, hypothesisId);
      if (!hypothesis) return null;
      const judgments = await judgmentRepo.listJudgmentsForHypothesisId(scoped, hypothesisId);
      return selectLatestConfidenceJudgmentForVersion(judgments, hypothesisId, asOf);
    },

    async getConfidenceEligibility(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      const ctx = await buildDerivationContext(scoped, input.hypothesisId, input.asOf);
      if (!ctx) return null;

      return deriveConfidenceEligibility({
        hypothesisId: input.hypothesisId,
        asOf: input.asOf,
        latestJudgment: ctx.latestJudgment,
        lifecycleState: ctx.lifecycleState,
        citationIntegrityInvalidated: ctx.citationIntegrityInvalidated,
      });
    },

    async getConfidenceEligibilityForLatestVersion(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      const latest = await hypothesisRepo.getLatestHypothesis(scoped, input.hypothesisKey);
      if (!latest) return null;
      const eligibility = await this.getConfidenceEligibility(scoped, {
        hypothesisId: latest.id,
        asOf: input.asOf,
      });
      if (!eligibility) return null;
      return { ...eligibility, versionSeq: latest.versionSeq };
    },

    async getConfidenceSignals(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      const ctx = await buildDerivationContext(scoped, input.hypothesisId, input.asOf);
      if (!ctx) return null;

      const asOfMs = input.asOf.getTime();
      const evidence = filterVisibleByIngestTime(
        await evidenceRepo.listEvidence(scoped, ctx.hypothesis.hypothesisKey),
        input.asOf,
      );
      const judgmentIngestMs = ctx.latestJudgment?.ingestTime.getTime() ?? null;

      const hasNewDisconfirmingEvidence =
        judgmentIngestMs !== null &&
        evidence.some(
          (row) =>
            row.direction === "AGAINST" &&
            row.hypothesisId === input.hypothesisId &&
            row.ingestTime.getTime() > judgmentIngestMs &&
            row.ingestTime.getTime() <= asOfMs,
        );

      const hasNewCorroboratingEvidence =
        judgmentIngestMs !== null &&
        evidence.some(
          (row) =>
            row.direction === "FOR" &&
            row.hypothesisId === input.hypothesisId &&
            row.ingestTime.getTime() > judgmentIngestMs &&
            row.ingestTime.getTime() <= asOfMs,
        );

      const history = await hypothesisRepo.listHypothesisHistory(
        scoped,
        ctx.hypothesis.hypothesisKey,
      );
      const visibleHistory = history.filter((row) => row.createdAt.getTime() <= asOfMs);
      const hasNewerHypothesisVersion = visibleHistory.some(
        (row) =>
          row.id !== input.hypothesisId &&
          row.versionSeq > ctx.hypothesis.versionSeq &&
          row.createdAt.getTime() <= asOfMs,
      );

      const expiringSoon =
        ctx.latestJudgment?.judgmentKind === "asserted" &&
        ctx.latestJudgment.reviewHorizonAt !== null &&
        ctx.latestJudgment.reviewHorizonAt.getTime() > asOfMs &&
        ctx.latestJudgment.reviewHorizonAt.getTime() <=
          asOfMs + MI_CONFIDENCE_EXPIRING_SOON_WINDOW_MS;

      return deriveConfidenceSignals({
        hypothesisId: input.hypothesisId,
        hypothesisKey: ctx.hypothesis.hypothesisKey,
        asOf: input.asOf,
        latestJudgment: ctx.latestJudgment,
        hasNewDisconfirmingEvidence,
        hasNewCorroboratingEvidence,
        hasNewerHypothesisVersion,
        expiringSoon,
      });
    },

    async getConfidenceJudgmentHistory(context, hypothesisId) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      const hypothesis = await loadHypothesisOrNull(scoped, hypothesisId);
      if (!hypothesis) {
        throw new MiHypothesisNotFoundError(
          "MI_HYPOTHESIS_NOT_FOUND: hypothesis must exist within organization scope",
        );
      }
      return judgmentRepo.listJudgmentsForHypothesisId(scoped, hypothesisId);
    },
  };
}

export function createSqliteMiConfidenceJudgmentService(
  db: WaiaDb,
  deps: MiConfidenceJudgmentServiceDeps = {},
): MiConfidenceJudgmentServiceBundle {
  const confidenceJudgmentRepository = createSqliteMiConfidenceJudgmentRepository(db);
  const hypothesisRepository = createSqliteMiHypothesisRepository(db);
  const evidenceRepository = createSqliteMiEvidenceRepository(db);
  const trialIntegrityRepository = createSqliteMiTrialIntegrityRepository(db);
  const confidenceJudgment = createService(
    confidenceJudgmentRepository,
    hypothesisRepository,
    evidenceRepository,
    trialIntegrityRepository,
    deps,
    (input) => writeTraderAuditLogSqlite(db, input),
  );
  return { confidenceJudgment, confidenceJudgmentRepository };
}

export function createPostgresMiConfidenceJudgmentService(
  ex: PgMiConfidenceJudgmentServiceExecutor,
  deps: MiConfidenceJudgmentServiceDeps = {},
): MiConfidenceJudgmentServiceBundle {
  const confidenceJudgmentRepository = createPostgresMiConfidenceJudgmentRepository(ex);
  const hypothesisRepository = createPostgresMiHypothesisRepository(ex);
  const evidenceRepository = createPostgresMiEvidenceRepository(ex);
  const trialIntegrityRepository = createPostgresMiTrialIntegrityRepository(ex);
  const confidenceJudgment = createService(
    confidenceJudgmentRepository,
    hypothesisRepository,
    evidenceRepository,
    trialIntegrityRepository,
    deps,
    (input) => writeTraderAuditLogPostgres(ex, input),
  );
  return { confidenceJudgment, confidenceJudgmentRepository };
}

export function createSqliteMiConfidenceJudgmentServiceWithMembership(
  db: WaiaDb,
  deps: MiConfidenceJudgmentServiceDeps = {},
): MiConfidenceJudgmentServiceBundle {
  return createSqliteMiConfidenceJudgmentService(db, {
    ...deps,
    assertMembership: deps.assertMembership
      ? deps.assertMembership
      : (context) => assertOrgMembershipSqlite(db, context),
  });
}

export function createPostgresMiConfidenceJudgmentServiceWithMembership(
  ex: PgMiConfidenceJudgmentServiceExecutor,
  deps: MiConfidenceJudgmentServiceDeps = {},
): MiConfidenceJudgmentServiceBundle {
  return createPostgresMiConfidenceJudgmentService(ex, {
    ...deps,
    assertMembership: deps.assertMembership
      ? deps.assertMembership
      : (context) => assertOrgMembershipPostgres(ex, context),
  });
}
