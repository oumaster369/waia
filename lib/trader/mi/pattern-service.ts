import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import {
  MiPatternDuplicateError,
  MiPatternFirewallError,
  MiPatternLifecycleError,
  MiPatternMeasurementRefError,
  MiPatternNotFoundError,
  MiPatternStructuralDuplicateError,
} from "@/lib/trader/mi/errors";
import {
  createPostgresMiMeasurementRepository,
  createSqliteMiMeasurementRepository,
} from "@/lib/trader/mi/measurement-repository-adapters";
import {
  MI_PATTERN_SCHEMA_VERSION,
  type MiPattern,
  type MiPatternKind,
  type MiPatternLifecycleEvent,
  type MiPatternLifecycleState,
  type PatternDefinition,
} from "@/lib/trader/mi/pattern.types";
import {
  createPostgresMiPatternRepository,
  createSqliteMiPatternRepository,
} from "@/lib/trader/mi/pattern-repository-adapters";
import {
  buildLifecycleContentDigest,
  buildPatternDefinitionDigest,
  buildPatternStructuralSignature,
  computePatternKey,
  findForbiddenDefinitionKey,
  serializePatternDefinitionJson,
} from "@/lib/trader/mi/serialize-pattern";
import type {
  AppendPatternVersionServiceInput,
  MiMeasurementRepository,
  MiPatternRepository,
  MiPatternServiceDeps,
  PatternLifecycleTransitionServiceInput,
  RegisterPatternServiceInput,
} from "@/lib/trader/mi/types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgMiPatternServiceExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export type MiPatternService = {
  registerPattern: (context: OrgContext, input: RegisterPatternServiceInput) => Promise<MiPattern>;
  appendPatternVersion: (
    context: OrgContext,
    input: AppendPatternVersionServiceInput,
  ) => Promise<MiPattern>;
  archivePattern: (
    context: OrgContext,
    input: PatternLifecycleTransitionServiceInput,
  ) => Promise<MiPatternLifecycleEvent>;
  reactivatePattern: (
    context: OrgContext,
    input: PatternLifecycleTransitionServiceInput,
  ) => Promise<MiPatternLifecycleEvent>;
  getLatestPattern: (context: OrgContext, patternKey: string) => Promise<MiPattern | null>;
  getPatternHistory: (context: OrgContext, patternKey: string) => Promise<MiPattern[]>;
  listPatterns: (context: OrgContext, patternKind?: MiPatternKind) => Promise<MiPattern[]>;
  getCurrentLifecycleState: (
    context: OrgContext,
    patternKey: string,
  ) => Promise<MiPatternLifecycleState | null>;
  listLifecycleEvents: (
    context: OrgContext,
    patternKey: string,
  ) => Promise<MiPatternLifecycleEvent[]>;
  findActivePatternByStructuralSignature: (
    context: OrgContext,
    structuralSignature: string,
  ) => Promise<MiPattern | null>;
};

export type MiPatternServiceBundle = {
  pattern: MiPatternService;
  /** Own DB-backed repository handle — not shared with execution/risk/gate paths. */
  patternRepository: MiPatternRepository;
};

async function assertMembershipIfNeeded(
  context: OrgContext,
  assertMembership: MiPatternServiceDeps["assertMembership"],
): Promise<void> {
  if (context.userId && assertMembership) {
    await assertMembership({ organizationId: context.organizationId, userId: context.userId });
  }
}

/** P5/RC-5 firewall: a definition must not encode Hypothesis/Regime-Knowledge claims. */
function assertFirewall(definition: PatternDefinition): void {
  const forbidden = findForbiddenDefinitionKey(definition);
  if (forbidden) {
    throw new MiPatternFirewallError(
      `MI_PATTERN_FIREWALL_VIOLATION: forbidden definition key '${forbidden}'`,
    );
  }
}

/** Immutable advisory allocation (RC-1): must be a non-negative integer; never consumed. */
function assertTrialBudgetMax(trialBudgetMax: number): void {
  if (!Number.isInteger(trialBudgetMax) || trialBudgetMax < 0) {
    throw new MiPatternMeasurementRefError(
      "MI_PATTERN_INPUT_INVALID: trialBudgetMax must be a non-negative integer",
    );
  }
}

/** RC-2 reproducibility pin validation: each ref must resolve to a known measurement version. */
async function assertMeasurementRefs(
  context: OrgContext,
  measurementRepo: MiMeasurementRepository,
  definition: PatternDefinition,
): Promise<void> {
  const refs = definition?.measurements;
  if (!Array.isArray(refs) || refs.length === 0) {
    throw new MiPatternMeasurementRefError(
      "MI_PATTERN_MEASUREMENT_REF_INVALID: at least one pinned measurement reference is required",
    );
  }
  for (const ref of refs) {
    if (!ref?.measurementKey || !ref?.measurementDefinitionDigest) {
      throw new MiPatternMeasurementRefError(
        "MI_PATTERN_MEASUREMENT_REF_INVALID: measurementKey and measurementDefinitionDigest are required",
      );
    }
    const measurement = await measurementRepo.findMeasurementByDigest(
      context,
      ref.measurementDefinitionDigest,
    );
    if (!measurement || measurement.measurementKey !== ref.measurementKey) {
      throw new MiPatternMeasurementRefError(
        `MI_PATTERN_MEASUREMENT_REF_INVALID: no measurement version matches key '${ref.measurementKey}' with the pinned digest`,
      );
    }
  }
}

function buildAuditInput(
  context: OrgContext,
  entityType: TraderAuditInput["entityType"],
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
    entityType,
    entityId,
    organizationId: context.organizationId,
    metadata,
  };
}

function createService(
  repo: MiPatternRepository,
  measurementRepo: MiMeasurementRepository,
  deps: MiPatternServiceDeps,
  writeAudit: (input: TraderAuditInput) => Promise<string> | string,
): MiPatternService {
  async function transition(
    context: OrgContext,
    input: PatternLifecycleTransitionServiceInput,
    target: MiPatternLifecycleState,
    action: TraderAuditInput["action"],
  ): Promise<MiPatternLifecycleEvent> {
    const scoped = requireOrgContext(context.organizationId);
    await assertMembershipIfNeeded(scoped, deps.assertMembership);

    const latestPattern = await repo.getLatestPattern(scoped, input.patternKey);
    if (!latestPattern) {
      throw new MiPatternNotFoundError();
    }

    const latestEvent = await repo.getLatestLifecycleEvent(scoped, input.patternKey);
    const currentState = latestEvent?.lifecycleState ?? null;
    if (currentState === target) {
      throw new MiPatternLifecycleError(
        `MI_PATTERN_LIFECYCLE_INVALID: pattern is already ${target}`,
      );
    }

    const seq = (latestEvent?.seq ?? 0) + 1;
    const now = new Date();
    const event = await repo.insertLifecycleEvent(scoped, {
      id: crypto.randomUUID(),
      patternId: latestPattern.id,
      patternKey: input.patternKey,
      lifecycleState: target,
      rationale: input.rationale,
      recordedBy: input.recordedBy,
      seq,
      contentDigest: buildLifecycleContentDigest({
        organizationId: scoped.organizationId,
        patternKey: input.patternKey,
        lifecycleState: target,
        seq,
        rationale: input.rationale,
        recordedBy: input.recordedBy,
      }),
      createdAt: now,
    });

    writeAudit(
      buildAuditInput(
        scoped,
        traderEntityTypes.miPatternLifecycle,
        event.id,
        action,
        {
          patternKey: event.patternKey,
          patternId: event.patternId,
          lifecycleState: event.lifecycleState,
          seq: event.seq,
        },
        input.actorType ?? deps.actorType ?? "service",
        input.actorId ?? deps.actorId ?? null,
      ),
    );

    return event;
  }

  return {
    async registerPattern(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      assertFirewall(input.definition);
      assertTrialBudgetMax(input.trialBudgetMax);
      await assertMeasurementRefs(scoped, measurementRepo, input.definition);

      const patternKey = computePatternKey({
        organizationId: scoped.organizationId,
        patternKind: input.patternKind,
        name: input.name,
      });

      const existing = await repo.getLatestPattern(scoped, patternKey);
      if (existing) {
        throw new MiPatternDuplicateError(
          "MI_PATTERN_DUPLICATE: family already registered; use appendPatternVersion",
        );
      }

      const structuralSignature = buildPatternStructuralSignature({
        patternKind: input.patternKind,
        definition: input.definition,
      });

      const activeDuplicate = await repo.findActivePatternByStructuralSignature(
        scoped,
        structuralSignature,
      );
      if (activeDuplicate) {
        throw new MiPatternStructuralDuplicateError(
          `MI_PATTERN_STRUCTURAL_DUPLICATE: an ACTIVE pattern with identical structure already exists (${activeDuplicate.patternKey})`,
        );
      }

      const definitionDigest = buildPatternDefinitionDigest({
        organizationId: scoped.organizationId,
        patternKey,
        patternKind: input.patternKind,
        name: input.name,
        definition: input.definition,
      });

      const now = new Date();
      const pattern = await repo.insertPatternVersion(scoped, {
        id: crypto.randomUUID(),
        patternKind: input.patternKind,
        patternKey,
        name: input.name,
        schemaVersion: MI_PATTERN_SCHEMA_VERSION,
        definitionJson: serializePatternDefinitionJson(input.definition),
        definitionDigest,
        structuralSignature,
        trialBudgetMax: input.trialBudgetMax,
        versionSeq: 1,
        revisionOf: null,
        authoredBy: input.authoredBy,
        createdAt: now,
      });

      await repo.insertLifecycleEvent(scoped, {
        id: crypto.randomUUID(),
        patternId: pattern.id,
        patternKey,
        lifecycleState: "ACTIVE",
        rationale: "registered",
        recordedBy: input.authoredBy,
        seq: 1,
        contentDigest: buildLifecycleContentDigest({
          organizationId: scoped.organizationId,
          patternKey,
          lifecycleState: "ACTIVE",
          seq: 1,
          rationale: "registered",
          recordedBy: input.authoredBy,
        }),
        createdAt: now,
      });

      writeAudit(
        buildAuditInput(
          scoped,
          traderEntityTypes.miPattern,
          pattern.id,
          traderAuditActions.miPatternRegistered,
          {
            patternKey: pattern.patternKey,
            patternKind: pattern.patternKind,
            name: pattern.name,
            versionSeq: pattern.versionSeq,
            definitionDigest: pattern.definitionDigest,
            structuralSignature: pattern.structuralSignature,
            trialBudgetMax: pattern.trialBudgetMax,
          },
          input.actorType ?? deps.actorType ?? "service",
          input.actorId ?? deps.actorId ?? null,
        ),
      );

      return pattern;
    },

    async appendPatternVersion(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      assertFirewall(input.definition);
      await assertMeasurementRefs(scoped, measurementRepo, input.definition);

      const patternKey = computePatternKey({
        organizationId: scoped.organizationId,
        patternKind: input.patternKind,
        name: input.name,
      });

      if (patternKey !== input.patternKey) {
        throw new Error("MI_PATTERN_KEY_MISMATCH");
      }

      const latest = await repo.getLatestPattern(scoped, patternKey);
      if (!latest) {
        throw new MiPatternNotFoundError();
      }

      const definitionDigest = buildPatternDefinitionDigest({
        organizationId: scoped.organizationId,
        patternKey,
        patternKind: input.patternKind,
        name: input.name,
        definition: input.definition,
      });

      if (definitionDigest === latest.definitionDigest) {
        throw new MiPatternDuplicateError(
          "MI_PATTERN_DUPLICATE: identical definition; no new version appended",
        );
      }

      const structuralSignature = buildPatternStructuralSignature({
        patternKind: input.patternKind,
        definition: input.definition,
      });

      const now = new Date();
      const pattern = await repo.insertPatternVersion(scoped, {
        id: crypto.randomUUID(),
        patternKind: input.patternKind,
        patternKey,
        name: input.name,
        schemaVersion: MI_PATTERN_SCHEMA_VERSION,
        definitionJson: serializePatternDefinitionJson(input.definition),
        definitionDigest,
        structuralSignature,
        // RC-1: trial_budget_max is immutable; inherited from the family, never re-supplied.
        trialBudgetMax: latest.trialBudgetMax,
        versionSeq: latest.versionSeq + 1,
        revisionOf: latest.id,
        authoredBy: input.authoredBy,
        createdAt: now,
      });

      writeAudit(
        buildAuditInput(
          scoped,
          traderEntityTypes.miPattern,
          pattern.id,
          traderAuditActions.miPatternRevised,
          {
            patternKey: pattern.patternKey,
            patternKind: pattern.patternKind,
            name: pattern.name,
            versionSeq: pattern.versionSeq,
            revisionOf: pattern.revisionOf,
            definitionDigest: pattern.definitionDigest,
            structuralSignature: pattern.structuralSignature,
          },
          input.actorType ?? deps.actorType ?? "service",
          input.actorId ?? deps.actorId ?? null,
        ),
      );

      return pattern;
    },

    archivePattern(context, input) {
      return transition(context, input, "ARCHIVED", traderAuditActions.miPatternArchived);
    },

    reactivatePattern(context, input) {
      return transition(context, input, "ACTIVE", traderAuditActions.miPatternReactivated);
    },

    async getLatestPattern(context, patternKey) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return repo.getLatestPattern(scoped, patternKey);
    },

    async getPatternHistory(context, patternKey) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return repo.listPatternHistory(scoped, patternKey);
    },

    async listPatterns(context, patternKind) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return repo.listPatterns(scoped, patternKind);
    },

    async getCurrentLifecycleState(context, patternKey) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      const latest = await repo.getLatestLifecycleEvent(scoped, patternKey);
      return latest?.lifecycleState ?? null;
    },

    async listLifecycleEvents(context, patternKey) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return repo.listLifecycleEvents(scoped, patternKey);
    },

    async findActivePatternByStructuralSignature(context, structuralSignature) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return repo.findActivePatternByStructuralSignature(scoped, structuralSignature);
    },
  };
}

export function createSqliteMiPatternService(
  db: WaiaDb,
  deps: MiPatternServiceDeps = {},
): MiPatternServiceBundle {
  const patternRepository = createSqliteMiPatternRepository(db);
  const measurementRepository = createSqliteMiMeasurementRepository(db);
  const pattern = createService(patternRepository, measurementRepository, deps, (input) =>
    writeTraderAuditLogSqlite(db, input),
  );
  return { pattern, patternRepository };
}

export function createPostgresMiPatternService(
  ex: PgMiPatternServiceExecutor,
  deps: MiPatternServiceDeps = {},
): MiPatternServiceBundle {
  const patternRepository = createPostgresMiPatternRepository(ex);
  const measurementRepository = createPostgresMiMeasurementRepository(ex);
  const pattern = createService(patternRepository, measurementRepository, deps, (input) =>
    writeTraderAuditLogPostgres(ex, input),
  );
  return { pattern, patternRepository };
}

export function createSqliteMiPatternServiceWithMembership(
  db: WaiaDb,
  deps: MiPatternServiceDeps = {},
): MiPatternServiceBundle {
  return createSqliteMiPatternService(db, {
    ...deps,
    assertMembership: deps.assertMembership
      ? deps.assertMembership
      : (context) => assertOrgMembershipSqlite(db, context),
  });
}

export function createPostgresMiPatternServiceWithMembership(
  ex: PgMiPatternServiceExecutor,
  deps: MiPatternServiceDeps = {},
): MiPatternServiceBundle {
  return createPostgresMiPatternService(ex, {
    ...deps,
    assertMembership: deps.assertMembership
      ? deps.assertMembership
      : (context) => assertOrgMembershipPostgres(ex, context),
  });
}

export { computePatternKey };
