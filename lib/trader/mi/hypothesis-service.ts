import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import {
  MiHypothesisDuplicateError,
  MiHypothesisFirewallError,
  MiHypothesisInputValidationError,
  MiHypothesisLifecycleAuthorizationError,
  MiHypothesisLifecycleError,
  MiHypothesisNotFoundError,
  MiHypothesisRefError,
  MiHypothesisSupersedesError,
} from "@/lib/trader/mi/errors";
import {
  createPostgresMiHypothesisRepository,
  createSqliteMiHypothesisRepository,
} from "@/lib/trader/mi/hypothesis-repository-adapters";
import {
  MI_HYPOTHESIS_SCHEMA_VERSION,
  miHypothesisNullKindValues,
  type ClaimShape,
  type HypothesisDefinition,
  type MiHypothesis,
  type MiHypothesisKind,
  type MiHypothesisLifecycleEvent,
  type MiHypothesisLifecycleState,
  type MiHypothesisWithCurrentState,
} from "@/lib/trader/mi/hypothesis.types";
import {
  createPostgresMiMeasurementRepository,
  createSqliteMiMeasurementRepository,
} from "@/lib/trader/mi/measurement-repository-adapters";
import {
  createPostgresMiPatternRepository,
  createSqliteMiPatternRepository,
} from "@/lib/trader/mi/pattern-repository-adapters";
import {
  buildHypothesisDefinitionDigest,
  buildLifecycleContentDigest,
  computeHypothesisKey,
  deriveMandatoryNullFloor,
  findForbiddenDefinitionKey,
  HYPOTHESIS_LIFECYCLE_TERMINAL_STATES,
  isAllowedHypothesisTransition,
  serializeHypothesisDefinitionJson,
} from "@/lib/trader/mi/serialize-hypothesis";
import type {
  AppendHypothesisVersionServiceInput,
  HypothesisLifecycleTransitionServiceInput,
  MiHypothesisRepository,
  MiHypothesisServiceDeps,
  MiMeasurementRepository,
  MiPatternRepository,
  RegisterHypothesisServiceInput,
} from "@/lib/trader/mi/types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgMiHypothesisServiceExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export type MiHypothesisService = {
  registerHypothesis: (
    context: OrgContext,
    input: RegisterHypothesisServiceInput,
  ) => Promise<MiHypothesis>;
  appendHypothesisVersion: (
    context: OrgContext,
    input: AppendHypothesisVersionServiceInput,
  ) => Promise<MiHypothesis>;
  getLatestHypothesis: (context: OrgContext, hypothesisKey: string) => Promise<MiHypothesis | null>;
  getHypothesisHistory: (context: OrgContext, hypothesisKey: string) => Promise<MiHypothesis[]>;
  listHypotheses: (
    context: OrgContext,
    hypothesisKind?: MiHypothesisKind,
  ) => Promise<MiHypothesis[]>;
  getCurrentLifecycleState: (
    context: OrgContext,
    hypothesisKey: string,
  ) => Promise<MiHypothesisLifecycleState | null>;
  listLifecycleEvents: (
    context: OrgContext,
    hypothesisKey: string,
  ) => Promise<MiHypothesisLifecycleEvent[]>;
  transitionHypothesisLifecycle: (
    context: OrgContext,
    input: HypothesisLifecycleTransitionServiceInput,
  ) => Promise<MiHypothesisLifecycleEvent>;
  getHypothesisWithCurrentState: (
    context: OrgContext,
    hypothesisKey: string,
  ) => Promise<MiHypothesisWithCurrentState | null>;
};

export type MiHypothesisServiceBundle = {
  hypothesis: MiHypothesisService;
  /** Own DB-backed repository handle — not shared with execution/risk/gate paths. */
  hypothesisRepository: MiHypothesisRepository;
};

const NULL_KIND_SET = new Set<string>(miHypothesisNullKindValues);

const HUMAN_LIFECYCLE_ACTOR_TYPES = new Set<TraderAuditInput["actorType"]>(["user", "admin"]);

function assertHumanLifecycleActor(
  input: HypothesisLifecycleTransitionServiceInput,
  deps: MiHypothesisServiceDeps,
): { actorType: "user" | "admin"; actorId: string | null } {
  const actorType = input.actorType ?? deps.actorType;
  if (!actorType || !HUMAN_LIFECYCLE_ACTOR_TYPES.has(actorType)) {
    throw new MiHypothesisLifecycleAuthorizationError(
      "MI_HYPOTHESIS_LIFECYCLE_UNAUTHORIZED: lifecycle transitions require actorType user or admin",
    );
  }
  if (!input.recordedBy?.trim()) {
    throw new MiHypothesisLifecycleAuthorizationError(
      "MI_HYPOTHESIS_LIFECYCLE_UNAUTHORIZED: recordedBy is required for lifecycle transitions",
    );
  }
  const humanActorType = actorType as "user" | "admin";
  return {
    actorType: humanActorType,
    actorId: input.actorId ?? deps.actorId ?? null,
  };
}

function assertLifecycleTransitionAllowed(
  currentState: MiHypothesisLifecycleState,
  toState: MiHypothesisLifecycleState,
): void {
  if (currentState === toState) {
    throw new MiHypothesisLifecycleError(
      `MI_HYPOTHESIS_LIFECYCLE_INVALID: hypothesis is already ${toState}`,
    );
  }
  if (HYPOTHESIS_LIFECYCLE_TERMINAL_STATES.has(currentState)) {
    throw new MiHypothesisLifecycleError(
      `MI_HYPOTHESIS_LIFECYCLE_INVALID: hypothesis is terminal (${currentState}); no transitions allowed`,
    );
  }
  if (!isAllowedHypothesisTransition(currentState, toState)) {
    throw new MiHypothesisLifecycleError(
      `MI_HYPOTHESIS_LIFECYCLE_INVALID: transition ${currentState} → ${toState} is forbidden`,
    );
  }
}

async function assertMembershipIfNeeded(
  context: OrgContext,
  assertMembership: MiHypothesisServiceDeps["assertMembership"],
): Promise<void> {
  if (context.userId && assertMembership) {
    await assertMembership({ organizationId: context.organizationId, userId: context.userId });
  }
}

function assertFirewall(definition: HypothesisDefinition): void {
  const forbidden = findForbiddenDefinitionKey(definition);
  if (forbidden) {
    throw new MiHypothesisFirewallError(
      `MI_HYPOTHESIS_FIREWALL_VIOLATION: forbidden definition key '${forbidden}'`,
    );
  }
}

function assertClaimShapeComplete(
  claimShape: ClaimShape | undefined,
): asserts claimShape is ClaimShape {
  if (
    !claimShape ||
    typeof claimShape.isDirectional !== "boolean" ||
    typeof claimShape.isTrendEdge !== "boolean" ||
    typeof claimShape.isTimingEdge !== "boolean" ||
    !claimShape.relationshipType
  ) {
    throw new MiHypothesisInputValidationError(
      "MI_HYPOTHESIS_INPUT_INVALID: claimShape requires relationshipType and all boolean edge flags",
    );
  }
}

function assertPriorAndFalsification(definition: HypothesisDefinition): void {
  if (!definition.prior?.ordinal || !definition.prior?.band) {
    throw new MiHypothesisInputValidationError(
      "MI_HYPOTHESIS_INPUT_INVALID: prior.ordinal and prior.band are required",
    );
  }
  if (
    !Array.isArray(definition.falsificationConditions) ||
    definition.falsificationConditions.length === 0
  ) {
    throw new MiHypothesisInputValidationError(
      "MI_HYPOTHESIS_INPUT_INVALID: at least one falsification condition is required",
    );
  }
}

function assertRequiredNullFloor(definition: HypothesisDefinition): void {
  assertClaimShapeComplete(definition.claimShape);
  const floor = deriveMandatoryNullFloor(definition.claimShape);
  const declared = definition.requiredNulls;
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new MiHypothesisInputValidationError(
      "MI_HYPOTHESIS_INPUT_INVALID: requiredNulls must be a non-empty array",
    );
  }
  for (const nullKind of declared) {
    if (!NULL_KIND_SET.has(nullKind)) {
      throw new MiHypothesisInputValidationError(
        `MI_HYPOTHESIS_INPUT_INVALID: unknown nullKind '${nullKind}'`,
      );
    }
  }
  const declaredSet = new Set(declared);
  for (const required of floor) {
    if (!declaredSet.has(required)) {
      throw new MiHypothesisInputValidationError(
        `MI_HYPOTHESIS_INPUT_INVALID: requiredNulls must include mandatory floor null '${required}'`,
      );
    }
  }
}

async function assertPinnedRefs(
  context: OrgContext,
  measurementRepo: MiMeasurementRepository,
  patternRepo: MiPatternRepository,
  definition: HypothesisDefinition,
): Promise<void> {
  const measurementRefs = definition.measurementRefs;
  const patternRefs = definition.patternRefs;
  if (
    (!Array.isArray(measurementRefs) || measurementRefs.length === 0) &&
    (!Array.isArray(patternRefs) || patternRefs.length === 0)
  ) {
    throw new MiHypothesisRefError(
      "MI_HYPOTHESIS_REF_INVALID: at least one pinned pattern or measurement reference is required",
    );
  }

  if (Array.isArray(measurementRefs)) {
    for (const ref of measurementRefs) {
      if (!ref?.measurementKey || !ref?.measurementDefinitionDigest) {
        throw new MiHypothesisRefError(
          "MI_HYPOTHESIS_REF_INVALID: measurementKey and measurementDefinitionDigest are required",
        );
      }
      const measurement = await measurementRepo.findMeasurementByDigest(
        context,
        ref.measurementDefinitionDigest,
      );
      if (!measurement || measurement.measurementKey !== ref.measurementKey) {
        throw new MiHypothesisRefError(
          `MI_HYPOTHESIS_REF_INVALID: no measurement version matches key '${ref.measurementKey}' with the pinned digest`,
        );
      }
    }
  }

  if (Array.isArray(patternRefs)) {
    for (const ref of patternRefs) {
      if (!ref?.patternKey || !ref?.patternDefinitionDigest) {
        throw new MiHypothesisRefError(
          "MI_HYPOTHESIS_REF_INVALID: patternKey and patternDefinitionDigest are required",
        );
      }
      const pattern = await patternRepo.findPatternByDigest(context, ref.patternDefinitionDigest);
      if (!pattern || pattern.patternKey !== ref.patternKey) {
        throw new MiHypothesisRefError(
          `MI_HYPOTHESIS_REF_INVALID: no pattern version matches key '${ref.patternKey}' with the pinned digest`,
        );
      }
    }
  }
}

async function assertSupersedesTargets(
  context: OrgContext,
  repo: MiHypothesisRepository,
  supersedes: readonly string[] | undefined,
): Promise<void> {
  if (!supersedes || supersedes.length === 0) return;
  for (const targetId of supersedes) {
    if (!targetId) {
      throw new MiHypothesisSupersedesError(
        "MI_HYPOTHESIS_SUPERSEDES_INVALID: supersedes entries must be non-empty hypothesis ids",
      );
    }
    const target = await repo.findHypothesisById(context, targetId);
    if (!target) {
      throw new MiHypothesisSupersedesError(
        `MI_HYPOTHESIS_SUPERSEDES_INVALID: supersedes target '${targetId}' does not exist`,
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

function validateDefinition(definition: HypothesisDefinition): void {
  assertFirewall(definition);
  assertClaimShapeComplete(definition.claimShape);
  assertPriorAndFalsification(definition);
  assertRequiredNullFloor(definition);
  if (!definition.regimeScope?.description) {
    throw new MiHypothesisInputValidationError(
      "MI_HYPOTHESIS_INPUT_INVALID: regimeScope.description is required",
    );
  }
}

function createService(
  repo: MiHypothesisRepository,
  measurementRepo: MiMeasurementRepository,
  patternRepo: MiPatternRepository,
  deps: MiHypothesisServiceDeps,
  writeAudit: (input: TraderAuditInput) => Promise<string> | string,
): MiHypothesisService {
  return {
    async registerHypothesis(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      validateDefinition(input.definition);
      await assertPinnedRefs(scoped, measurementRepo, patternRepo, input.definition);
      await assertSupersedesTargets(scoped, repo, input.supersedes);

      const hypothesisKey = computeHypothesisKey({
        organizationId: scoped.organizationId,
        hypothesisKind: input.hypothesisKind,
        name: input.name,
      });

      const existing = await repo.getLatestHypothesis(scoped, hypothesisKey);
      if (existing) {
        throw new MiHypothesisDuplicateError(
          "MI_HYPOTHESIS_DUPLICATE: family already registered; use appendHypothesisVersion",
        );
      }

      const definitionDigest = buildHypothesisDefinitionDigest({
        organizationId: scoped.organizationId,
        hypothesisKey,
        hypothesisKind: input.hypothesisKind,
        name: input.name,
        definition: input.definition,
      });

      const supersedesJson =
        input.supersedes && input.supersedes.length > 0
          ? JSON.stringify([...input.supersedes])
          : null;

      const now = new Date();
      const hypothesis = await repo.insertHypothesisVersion(scoped, {
        id: crypto.randomUUID(),
        hypothesisKind: input.hypothesisKind,
        hypothesisKey,
        name: input.name,
        schemaVersion: MI_HYPOTHESIS_SCHEMA_VERSION,
        definitionJson: serializeHypothesisDefinitionJson(input.definition),
        definitionDigest,
        supersedesJson,
        versionSeq: 1,
        revisionOf: null,
        authoredBy: input.authoredBy,
        createdAt: now,
      });

      await repo.insertLifecycleEvent(scoped, {
        id: crypto.randomUUID(),
        hypothesisId: hypothesis.id,
        hypothesisKey,
        lifecycleState: "PROPOSED",
        rationale: "registered",
        recordedBy: input.authoredBy,
        seq: 1,
        contentDigest: buildLifecycleContentDigest({
          organizationId: scoped.organizationId,
          hypothesisKey,
          lifecycleState: "PROPOSED",
          seq: 1,
          rationale: "registered",
          recordedBy: input.authoredBy,
        }),
        createdAt: now,
      });

      writeAudit(
        buildAuditInput(
          scoped,
          traderEntityTypes.miHypothesis,
          hypothesis.id,
          traderAuditActions.miHypothesisRegistered,
          {
            hypothesisKey: hypothesis.hypothesisKey,
            hypothesisKind: hypothesis.hypothesisKind,
            name: hypothesis.name,
            versionSeq: hypothesis.versionSeq,
            definitionDigest: hypothesis.definitionDigest,
            supersedesJson: hypothesis.supersedesJson,
          },
          input.actorType ?? deps.actorType ?? "service",
          input.actorId ?? deps.actorId ?? null,
        ),
      );

      return hypothesis;
    },

    async appendHypothesisVersion(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      validateDefinition(input.definition);
      await assertPinnedRefs(scoped, measurementRepo, patternRepo, input.definition);

      const hypothesisKey = computeHypothesisKey({
        organizationId: scoped.organizationId,
        hypothesisKind: input.hypothesisKind,
        name: input.name,
      });

      if (hypothesisKey !== input.hypothesisKey) {
        throw new Error("MI_HYPOTHESIS_KEY_MISMATCH");
      }

      const latest = await repo.getLatestHypothesis(scoped, hypothesisKey);
      if (!latest) {
        throw new MiHypothesisNotFoundError();
      }

      const definitionDigest = buildHypothesisDefinitionDigest({
        organizationId: scoped.organizationId,
        hypothesisKey,
        hypothesisKind: input.hypothesisKind,
        name: input.name,
        definition: input.definition,
      });

      if (definitionDigest === latest.definitionDigest) {
        throw new MiHypothesisDuplicateError(
          "MI_HYPOTHESIS_DUPLICATE: identical definition; no new version appended",
        );
      }

      const now = new Date();
      const hypothesis = await repo.insertHypothesisVersion(scoped, {
        id: crypto.randomUUID(),
        hypothesisKind: input.hypothesisKind,
        hypothesisKey,
        name: input.name,
        schemaVersion: MI_HYPOTHESIS_SCHEMA_VERSION,
        definitionJson: serializeHypothesisDefinitionJson(input.definition),
        definitionDigest,
        supersedesJson: latest.supersedesJson,
        versionSeq: latest.versionSeq + 1,
        revisionOf: latest.id,
        authoredBy: input.authoredBy,
        createdAt: now,
      });

      writeAudit(
        buildAuditInput(
          scoped,
          traderEntityTypes.miHypothesis,
          hypothesis.id,
          traderAuditActions.miHypothesisRevised,
          {
            hypothesisKey: hypothesis.hypothesisKey,
            hypothesisKind: hypothesis.hypothesisKind,
            name: hypothesis.name,
            versionSeq: hypothesis.versionSeq,
            revisionOf: hypothesis.revisionOf,
            definitionDigest: hypothesis.definitionDigest,
          },
          input.actorType ?? deps.actorType ?? "service",
          input.actorId ?? deps.actorId ?? null,
        ),
      );

      return hypothesis;
    },

    async getLatestHypothesis(context, hypothesisKey) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return repo.getLatestHypothesis(scoped, hypothesisKey);
    },

    async getHypothesisHistory(context, hypothesisKey) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return repo.listHypothesisHistory(scoped, hypothesisKey);
    },

    async listHypotheses(context, hypothesisKind) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return repo.listHypotheses(scoped, hypothesisKind);
    },

    async getCurrentLifecycleState(context, hypothesisKey) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      const latest = await repo.getLatestLifecycleEvent(scoped, hypothesisKey);
      return latest?.lifecycleState ?? null;
    },

    async listLifecycleEvents(context, hypothesisKey) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return repo.listLifecycleEvents(scoped, hypothesisKey);
    },

    async transitionHypothesisLifecycle(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      const actor = assertHumanLifecycleActor(input, deps);

      const latestHypothesis = await repo.getLatestHypothesis(scoped, input.hypothesisKey);
      if (!latestHypothesis) {
        throw new MiHypothesisNotFoundError();
      }

      const latestEvent = await repo.getLatestLifecycleEvent(scoped, input.hypothesisKey);
      if (!latestEvent) {
        throw new MiHypothesisLifecycleError(
          "MI_HYPOTHESIS_LIFECYCLE_INVALID: no lifecycle ledger head exists for hypothesis",
        );
      }

      const currentState = latestEvent.lifecycleState;
      assertLifecycleTransitionAllowed(currentState, input.toState);

      const seq = latestEvent.seq + 1;
      const now = new Date();
      const event = await repo.insertLifecycleEvent(scoped, {
        id: crypto.randomUUID(),
        hypothesisId: latestHypothesis.id,
        hypothesisKey: input.hypothesisKey,
        lifecycleState: input.toState,
        rationale: input.rationale,
        recordedBy: input.recordedBy,
        seq,
        contentDigest: buildLifecycleContentDigest({
          organizationId: scoped.organizationId,
          hypothesisKey: input.hypothesisKey,
          lifecycleState: input.toState,
          seq,
          rationale: input.rationale,
          recordedBy: input.recordedBy,
        }),
        createdAt: now,
      });

      writeAudit(
        buildAuditInput(
          scoped,
          traderEntityTypes.miHypothesisLifecycle,
          event.id,
          traderAuditActions.miHypothesisLifecycleTransitioned,
          {
            hypothesisKey: event.hypothesisKey,
            hypothesisId: event.hypothesisId,
            fromState: currentState,
            toState: event.lifecycleState,
            seq: event.seq,
            rationale: event.rationale,
          },
          actor.actorType,
          actor.actorId,
        ),
      );

      return event;
    },

    async getHypothesisWithCurrentState(context, hypothesisKey) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const hypothesis = await repo.getLatestHypothesis(scoped, hypothesisKey);
      if (!hypothesis) {
        return null;
      }

      const latestEvent = await repo.getLatestLifecycleEvent(scoped, hypothesisKey);
      if (!latestEvent) {
        throw new MiHypothesisLifecycleError(
          "MI_HYPOTHESIS_LIFECYCLE_INVALID: no lifecycle ledger head exists for hypothesis",
        );
      }

      return {
        hypothesis,
        currentState: latestEvent.lifecycleState,
      };
    },
  };
}

export function createSqliteMiHypothesisService(
  db: WaiaDb,
  deps: MiHypothesisServiceDeps = {},
): MiHypothesisServiceBundle {
  const hypothesisRepository = createSqliteMiHypothesisRepository(db);
  const measurementRepository = createSqliteMiMeasurementRepository(db);
  const patternRepository = createSqliteMiPatternRepository(db);
  const hypothesis = createService(
    hypothesisRepository,
    measurementRepository,
    patternRepository,
    deps,
    (input) => writeTraderAuditLogSqlite(db, input),
  );
  return { hypothesis, hypothesisRepository };
}

export function createPostgresMiHypothesisService(
  ex: PgMiHypothesisServiceExecutor,
  deps: MiHypothesisServiceDeps = {},
): MiHypothesisServiceBundle {
  const hypothesisRepository = createPostgresMiHypothesisRepository(ex);
  const measurementRepository = createPostgresMiMeasurementRepository(ex);
  const patternRepository = createPostgresMiPatternRepository(ex);
  const hypothesis = createService(
    hypothesisRepository,
    measurementRepository,
    patternRepository,
    deps,
    (input) => writeTraderAuditLogPostgres(ex, input),
  );
  return { hypothesis, hypothesisRepository };
}

export function createSqliteMiHypothesisServiceWithMembership(
  db: WaiaDb,
  deps: MiHypothesisServiceDeps = {},
): MiHypothesisServiceBundle {
  return createSqliteMiHypothesisService(db, {
    ...deps,
    assertMembership: deps.assertMembership
      ? deps.assertMembership
      : (context) => assertOrgMembershipSqlite(db, context),
  });
}

export function createPostgresMiHypothesisServiceWithMembership(
  ex: PgMiHypothesisServiceExecutor,
  deps: MiHypothesisServiceDeps = {},
): MiHypothesisServiceBundle {
  return createPostgresMiHypothesisService(ex, {
    ...deps,
    assertMembership: deps.assertMembership
      ? deps.assertMembership
      : (context) => assertOrgMembershipPostgres(ex, context),
  });
}

export { computeHypothesisKey };
