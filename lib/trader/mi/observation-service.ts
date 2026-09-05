import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import {
  EventTimeNotKnowableError,
  MiObservationNotFoundError,
  MiSourceNotFoundError,
  PitViolationError,
} from "@/lib/trader/mi/errors";
import {
  MI_MSV_INTERNAL_SOURCE,
  MI_OBSERVATION_SCHEMA_VERSION,
  type PitObservation,
} from "@/lib/trader/mi/observation.types";
import {
  createPostgresMiObservationRepository,
  createSqliteMiObservationRepository,
} from "@/lib/trader/mi/observation-repository-adapters";
import {
  buildObservationDigestFromMsv,
  computeObservationKey,
  parseMsvPayloadJson,
} from "@/lib/trader/mi/serialize-observation";
import type { MiSourceProvenanceRepository } from "@/lib/trader/mi/types";
import type {
  AppendObservationRevisionServiceInput,
  MiObservationRepository,
  MiObservationServiceDeps,
  RecordObservationServiceInput,
} from "@/lib/trader/mi/types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgMiObservationServiceExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export type MiObservationService = {
  resolveInternalMsvSource: (context: OrgContext) => Promise<{ id: string }>;
  recordObservation: (
    context: OrgContext,
    input: RecordObservationServiceInput,
  ) => Promise<PitObservation>;
  appendObservationRevision: (
    context: OrgContext,
    input: AppendObservationRevisionServiceInput,
  ) => Promise<PitObservation>;
  getLatestObservation: (
    context: OrgContext,
    observationKey: string,
  ) => Promise<PitObservation | null>;
  getObservationHistory: (context: OrgContext, observationKey: string) => Promise<PitObservation[]>;
  listObservations: (
    context: OrgContext,
    observationKind?: import("@/lib/trader/mi/observation.types").MiObservationKind,
  ) => Promise<PitObservation[]>;
};

export type MiObservationServiceBundle = {
  observation: MiObservationService;
  /** Own DB-backed repository handle — not shared with execution/risk/gate paths (R5). */
  observationRepository: MiObservationRepository;
};

async function assertMembershipIfNeeded(
  context: OrgContext,
  assertMembership: MiObservationServiceDeps["assertMembership"],
): Promise<void> {
  if (context.userId && assertMembership) {
    await assertMembership({ organizationId: context.organizationId, userId: context.userId });
  }
}

function buildAuditInput(
  context: OrgContext,
  entityId: string,
  action: TraderAuditInput["action"],
  metadata: Record<string, unknown>,
  actorType: TraderAuditInput["actorType"] = "service",
  actorId: string | null = null,
): TraderAuditInput {
  return {
    actorType,
    actorId,
    action,
    entityType: traderEntityTypes.miObservation,
    entityId,
    organizationId: context.organizationId,
    metadata,
  };
}

function assertPit(eventTime: Date, ingestTime: Date): void {
  if (ingestTime.getTime() < eventTime.getTime()) {
    throw new PitViolationError();
  }
}

function buildDigestForPayload(input: {
  organizationId: string;
  sourceId: string;
  observationKey: string;
  observationKind: RecordObservationServiceInput["observationKind"];
  subjectRef: string;
  eventTime: Date;
  payloadJson: string;
}): string {
  const msv = parseMsvPayloadJson(input.payloadJson);
  return buildObservationDigestFromMsv({
    organizationId: input.organizationId,
    sourceId: input.sourceId,
    observationKey: input.observationKey,
    observationKind: input.observationKind,
    subjectRef: input.subjectRef,
    eventTime: input.eventTime,
    msv,
  });
}

function createService(
  obsRepo: MiObservationRepository,
  sourceRepo: MiSourceProvenanceRepository,
  deps: MiObservationServiceDeps,
  writeAudit: (input: TraderAuditInput) => Promise<string> | string,
): MiObservationService {
  return {
    async resolveInternalMsvSource(context) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const existing = await sourceRepo.findSourceByLogicalKey(
        scoped,
        MI_MSV_INTERNAL_SOURCE.venue,
        MI_MSV_INTERNAL_SOURCE.feedKind,
        MI_MSV_INTERNAL_SOURCE.symbol,
      );
      if (existing) {
        return { id: existing.id };
      }

      const id = crypto.randomUUID();
      const now = new Date();
      const source = await sourceRepo.insertSource(
        scoped,
        {
          venue: MI_MSV_INTERNAL_SOURCE.venue,
          feedKind: MI_MSV_INTERNAL_SOURCE.feedKind,
          symbol: MI_MSV_INTERNAL_SOURCE.symbol,
          description: MI_MSV_INTERNAL_SOURCE.description,
          status: "active",
        },
        id,
        now,
      );
      return { id: source.id };
    },

    async recordObservation(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const source = await sourceRepo.getSourceById(scoped, input.sourceId);
      if (!source) {
        throw new MiSourceNotFoundError();
      }

      assertPit(input.eventTime, input.ingestTime);

      const observationKey = computeObservationKey({
        organizationId: scoped.organizationId,
        sourceId: input.sourceId,
        observationKind: input.observationKind,
        subjectRef: input.subjectRef,
        eventTime: input.eventTime,
      });

      const latest = await obsRepo.getLatestObservation(scoped, observationKey);
      if (latest) {
        throw new Error("MI_OBSERVATION_ALREADY_EXISTS");
      }

      const contentDigest = buildDigestForPayload({
        organizationId: scoped.organizationId,
        sourceId: input.sourceId,
        observationKey,
        observationKind: input.observationKind,
        subjectRef: input.subjectRef,
        eventTime: input.eventTime,
        payloadJson: input.payloadJson,
      });

      const id = crypto.randomUUID();
      const now = new Date();
      const observation = await obsRepo.insertObservation(scoped, {
        id,
        sourceId: input.sourceId,
        observationKind: input.observationKind,
        observationKey,
        subjectRef: input.subjectRef,
        schemaVersion: MI_OBSERVATION_SCHEMA_VERSION,
        payloadJson: input.payloadJson,
        eventTime: input.eventTime,
        ingestTime: input.ingestTime,
        observedBy: input.observedBy,
        revisionOf: null,
        revisionSeq: 1,
        contentDigest,
        createdAt: now,
      });

      await writeAudit(
        buildAuditInput(
          scoped,
          observation.id,
          traderAuditActions.miObservationRecorded,
          {
            observationKey: observation.observationKey,
            observationKind: observation.observationKind,
            sourceId: observation.sourceId,
            revisionSeq: observation.revisionSeq,
            contentDigest: observation.contentDigest,
          },
          input.actorType ?? deps.actorType ?? "service",
          input.actorId ?? deps.actorId ?? null,
        ),
      );

      return observation;
    },

    async appendObservationRevision(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const source = await sourceRepo.getSourceById(scoped, input.sourceId);
      if (!source) {
        throw new MiSourceNotFoundError();
      }

      assertPit(input.eventTime, input.ingestTime);

      const observationKey = computeObservationKey({
        organizationId: scoped.organizationId,
        sourceId: input.sourceId,
        observationKind: input.observationKind,
        subjectRef: input.subjectRef,
        eventTime: input.eventTime,
      });

      if (observationKey !== input.observationKey) {
        throw new Error("MI_OBSERVATION_KEY_MISMATCH");
      }

      const latest = await obsRepo.getLatestObservation(scoped, observationKey);
      if (!latest) {
        throw new MiObservationNotFoundError();
      }

      const revisionSeq = latest.revisionSeq + 1;
      const revisionOf = latest.id;

      const contentDigest = buildDigestForPayload({
        organizationId: scoped.organizationId,
        sourceId: input.sourceId,
        observationKey,
        observationKind: input.observationKind,
        subjectRef: input.subjectRef,
        eventTime: input.eventTime,
        payloadJson: input.payloadJson,
      });

      const id = crypto.randomUUID();
      const now = new Date();
      const observation = await obsRepo.insertObservation(scoped, {
        id,
        sourceId: input.sourceId,
        observationKind: input.observationKind,
        observationKey,
        subjectRef: input.subjectRef,
        schemaVersion: MI_OBSERVATION_SCHEMA_VERSION,
        payloadJson: input.payloadJson,
        eventTime: input.eventTime,
        ingestTime: input.ingestTime,
        observedBy: input.observedBy,
        revisionOf,
        revisionSeq,
        contentDigest,
        createdAt: now,
      });

      await writeAudit(
        buildAuditInput(
          scoped,
          observation.id,
          traderAuditActions.miObservationRevised,
          {
            observationKey: observation.observationKey,
            observationKind: observation.observationKind,
            sourceId: observation.sourceId,
            revisionSeq: observation.revisionSeq,
            revisionOf: observation.revisionOf,
            contentDigest: observation.contentDigest,
          },
          input.actorType ?? deps.actorType ?? "service",
          input.actorId ?? deps.actorId ?? null,
        ),
      );

      return observation;
    },

    async getLatestObservation(context, observationKey) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return obsRepo.getLatestObservation(scoped, observationKey);
    },

    async getObservationHistory(context, observationKey) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return obsRepo.listObservationHistory(scoped, observationKey);
    },

    async listObservations(context, observationKind) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return obsRepo.listObservations(scoped, observationKind);
    },
  };
}

export function createSqliteMiObservationService(
  db: WaiaDb,
  sourceRepo: MiSourceProvenanceRepository,
  deps: MiObservationServiceDeps = {},
): MiObservationServiceBundle {
  const observationRepository = createSqliteMiObservationRepository(db);
  const observation = createService(observationRepository, sourceRepo, deps, (input) =>
    writeTraderAuditLogSqlite(db, input),
  );
  return { observation, observationRepository };
}

export function createPostgresMiObservationService(
  ex: PgMiObservationServiceExecutor,
  sourceRepo: MiSourceProvenanceRepository,
  deps: MiObservationServiceDeps = {},
): MiObservationServiceBundle {
  const observationRepository = createPostgresMiObservationRepository(ex);
  const observation = createService(observationRepository, sourceRepo, deps, (input) =>
    writeTraderAuditLogPostgres(ex, input),
  );
  return { observation, observationRepository };
}

export function createSqliteMiObservationServiceWithMembership(
  db: WaiaDb,
  sourceRepo: MiSourceProvenanceRepository,
  deps: MiObservationServiceDeps = {},
): MiObservationServiceBundle {
  return createSqliteMiObservationService(db, sourceRepo, {
    ...deps,
    assertMembership: deps.assertMembership
      ? deps.assertMembership
      : (context) => assertOrgMembershipSqlite(db, context),
  });
}

export function createPostgresMiObservationServiceWithMembership(
  ex: PgMiObservationServiceExecutor,
  sourceRepo: MiSourceProvenanceRepository,
  deps: MiObservationServiceDeps = {},
): MiObservationServiceBundle {
  return createPostgresMiObservationService(ex, sourceRepo, {
    ...deps,
    assertMembership: deps.assertMembership
      ? deps.assertMembership
      : (context) => assertOrgMembershipPostgres(ex, context),
  });
}

export function resolveMsvMarketKnowableEventTime(input: {
  msvEvaluatedAt: string;
  marketKnowableEventTime: string;
}): Date {
  const knowableMs = Date.parse(input.marketKnowableEventTime);
  const evaluatedMs = Date.parse(input.msvEvaluatedAt);
  if (Number.isNaN(knowableMs) || Number.isNaN(evaluatedMs) || evaluatedMs !== knowableMs) {
    throw new EventTimeNotKnowableError();
  }
  return new Date(knowableMs);
}

export { EventTimeNotKnowableError, computeObservationKey };
