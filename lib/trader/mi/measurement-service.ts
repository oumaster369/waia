import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import {
  MiMeasurementDuplicateError,
  MiMeasurementInputValidationError,
  MiMeasurementNotFoundError,
} from "@/lib/trader/mi/errors";
import {
  MI_MEASUREMENT_SCHEMA_VERSION,
  type MeasurementDefinition,
  type MiMeasurement,
} from "@/lib/trader/mi/measurement.types";
import {
  createPostgresMiMeasurementRepository,
  createSqliteMiMeasurementRepository,
} from "@/lib/trader/mi/measurement-repository-adapters";
import { miObservationKindValues } from "@/lib/trader/mi/observation.types";
import {
  buildMeasurementDigestFromDefinition,
  computeMeasurementKey,
  serializeMeasurementDefinitionJson,
} from "@/lib/trader/mi/serialize-measurement";
import type {
  AppendMeasurementVersionServiceInput,
  MiMeasurementRepository,
  MiMeasurementServiceDeps,
  RegisterMeasurementServiceInput,
} from "@/lib/trader/mi/types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgMiMeasurementServiceExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export type MiMeasurementService = {
  registerMeasurement: (
    context: OrgContext,
    input: RegisterMeasurementServiceInput,
  ) => Promise<MiMeasurement>;
  appendMeasurementVersion: (
    context: OrgContext,
    input: AppendMeasurementVersionServiceInput,
  ) => Promise<MiMeasurement>;
  getLatestMeasurement: (
    context: OrgContext,
    measurementKey: string,
  ) => Promise<MiMeasurement | null>;
  getMeasurementHistory: (context: OrgContext, measurementKey: string) => Promise<MiMeasurement[]>;
  listMeasurements: (
    context: OrgContext,
    measurementKind?: import("@/lib/trader/mi/measurement.types").MiMeasurementKind,
  ) => Promise<MiMeasurement[]>;
};

export type MiMeasurementServiceBundle = {
  measurement: MiMeasurementService;
  /** Own DB-backed repository handle — not shared with execution/risk/gate paths. */
  measurementRepository: MiMeasurementRepository;
};

const KNOWN_OBSERVATION_KINDS = new Set<string>(miObservationKindValues);

async function assertMembershipIfNeeded(
  context: OrgContext,
  assertMembership: MiMeasurementServiceDeps["assertMembership"],
): Promise<void> {
  if (context.userId && assertMembership) {
    await assertMembership({ organizationId: context.organizationId, userId: context.userId });
  }
}

/** Declarative lineage validation (M6): definition must declare ≥1 known input observation kind. */
function assertDeclaredInputs(definition: MeasurementDefinition): void {
  const observationKinds = definition?.inputs?.observationKinds;
  if (!Array.isArray(observationKinds) || observationKinds.length === 0) {
    throw new MiMeasurementInputValidationError(
      "MI_MEASUREMENT_INPUT_INVALID: at least one input observation kind is required",
    );
  }
  for (const kind of observationKinds) {
    if (!KNOWN_OBSERVATION_KINDS.has(kind)) {
      throw new MiMeasurementInputValidationError(
        `MI_MEASUREMENT_INPUT_INVALID: unknown observation kind '${String(kind)}'`,
      );
    }
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
    entityType: traderEntityTypes.miMeasurement,
    entityId,
    organizationId: context.organizationId,
    metadata,
  };
}

function createService(
  repo: MiMeasurementRepository,
  deps: MiMeasurementServiceDeps,
  writeAudit: (input: TraderAuditInput) => Promise<string> | string,
): MiMeasurementService {
  return {
    async registerMeasurement(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      assertDeclaredInputs(input.definition);

      const measurementKey = computeMeasurementKey({
        organizationId: scoped.organizationId,
        measurementKind: input.measurementKind,
        name: input.name,
      });

      const latest = await repo.getLatestMeasurement(scoped, measurementKey);
      if (latest) {
        throw new MiMeasurementDuplicateError(
          "MI_MEASUREMENT_DUPLICATE: family already registered; use appendMeasurementVersion",
        );
      }

      const definitionDigest = buildMeasurementDigestFromDefinition({
        organizationId: scoped.organizationId,
        measurementKey,
        measurementKind: input.measurementKind,
        name: input.name,
        definition: input.definition,
      });

      const id = crypto.randomUUID();
      const now = new Date();
      const measurement = await repo.insertMeasurementVersion(scoped, {
        id,
        measurementKind: input.measurementKind,
        measurementKey,
        name: input.name,
        schemaVersion: MI_MEASUREMENT_SCHEMA_VERSION,
        definitionJson: serializeMeasurementDefinitionJson(input.definition),
        definitionDigest,
        versionSeq: 1,
        revisionOf: null,
        authoredBy: input.authoredBy,
        createdAt: now,
      });

      writeAudit(
        buildAuditInput(
          scoped,
          measurement.id,
          traderAuditActions.miMeasurementRegistered,
          {
            measurementKey: measurement.measurementKey,
            measurementKind: measurement.measurementKind,
            name: measurement.name,
            versionSeq: measurement.versionSeq,
            definitionDigest: measurement.definitionDigest,
          },
          input.actorType ?? deps.actorType ?? "service",
          input.actorId ?? deps.actorId ?? null,
        ),
      );

      return measurement;
    },

    async appendMeasurementVersion(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      assertDeclaredInputs(input.definition);

      const measurementKey = computeMeasurementKey({
        organizationId: scoped.organizationId,
        measurementKind: input.measurementKind,
        name: input.name,
      });

      if (measurementKey !== input.measurementKey) {
        throw new Error("MI_MEASUREMENT_KEY_MISMATCH");
      }

      const latest = await repo.getLatestMeasurement(scoped, measurementKey);
      if (!latest) {
        throw new MiMeasurementNotFoundError();
      }

      const definitionDigest = buildMeasurementDigestFromDefinition({
        organizationId: scoped.organizationId,
        measurementKey,
        measurementKind: input.measurementKind,
        name: input.name,
        definition: input.definition,
      });

      if (definitionDigest === latest.definitionDigest) {
        throw new MiMeasurementDuplicateError(
          "MI_MEASUREMENT_DUPLICATE: identical definition; no new version appended",
        );
      }

      const id = crypto.randomUUID();
      const now = new Date();
      const measurement = await repo.insertMeasurementVersion(scoped, {
        id,
        measurementKind: input.measurementKind,
        measurementKey,
        name: input.name,
        schemaVersion: MI_MEASUREMENT_SCHEMA_VERSION,
        definitionJson: serializeMeasurementDefinitionJson(input.definition),
        definitionDigest,
        versionSeq: latest.versionSeq + 1,
        revisionOf: latest.id,
        authoredBy: input.authoredBy,
        createdAt: now,
      });

      writeAudit(
        buildAuditInput(
          scoped,
          measurement.id,
          traderAuditActions.miMeasurementRevised,
          {
            measurementKey: measurement.measurementKey,
            measurementKind: measurement.measurementKind,
            name: measurement.name,
            versionSeq: measurement.versionSeq,
            revisionOf: measurement.revisionOf,
            definitionDigest: measurement.definitionDigest,
          },
          input.actorType ?? deps.actorType ?? "service",
          input.actorId ?? deps.actorId ?? null,
        ),
      );

      return measurement;
    },

    async getLatestMeasurement(context, measurementKey) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return repo.getLatestMeasurement(scoped, measurementKey);
    },

    async getMeasurementHistory(context, measurementKey) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return repo.listMeasurementHistory(scoped, measurementKey);
    },

    async listMeasurements(context, measurementKind) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return repo.listMeasurements(scoped, measurementKind);
    },
  };
}

export function createSqliteMiMeasurementService(
  db: WaiaDb,
  deps: MiMeasurementServiceDeps = {},
): MiMeasurementServiceBundle {
  const measurementRepository = createSqliteMiMeasurementRepository(db);
  const measurement = createService(measurementRepository, deps, (input) =>
    writeTraderAuditLogSqlite(db, input),
  );
  return { measurement, measurementRepository };
}

export function createPostgresMiMeasurementService(
  ex: PgMiMeasurementServiceExecutor,
  deps: MiMeasurementServiceDeps = {},
): MiMeasurementServiceBundle {
  const measurementRepository = createPostgresMiMeasurementRepository(ex);
  const measurement = createService(measurementRepository, deps, (input) =>
    writeTraderAuditLogPostgres(ex, input),
  );
  return { measurement, measurementRepository };
}

export function createSqliteMiMeasurementServiceWithMembership(
  db: WaiaDb,
  deps: MiMeasurementServiceDeps = {},
): MiMeasurementServiceBundle {
  return createSqliteMiMeasurementService(db, {
    ...deps,
    assertMembership: deps.assertMembership
      ? deps.assertMembership
      : (context) => assertOrgMembershipSqlite(db, context),
  });
}

export function createPostgresMiMeasurementServiceWithMembership(
  ex: PgMiMeasurementServiceExecutor,
  deps: MiMeasurementServiceDeps = {},
): MiMeasurementServiceBundle {
  return createPostgresMiMeasurementService(ex, {
    ...deps,
    assertMembership: deps.assertMembership
      ? deps.assertMembership
      : (context) => assertOrgMembershipPostgres(ex, context),
  });
}

export { computeMeasurementKey };
