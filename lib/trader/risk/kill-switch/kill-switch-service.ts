import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeAuditLogPostgres, writeAuditLogSqlite } from "@/lib/waia-core/audit/write";
import {
  assertPlatformKillSwitchAuthorityPostgres,
  assertPlatformKillSwitchAuthoritySqlite,
  assertRecoveryConfirmAuthorityPostgres,
  assertRecoveryConfirmAuthoritySqlite,
} from "@/lib/trader/risk/kill-switch/authorization";
import {
  KILL_SWITCH_ALREADY_ACTIVE,
  KillSwitchAuthorizationError,
  KillSwitchConcurrencyError,
  KillSwitchCoolingOffNotElapsedError,
  KillSwitchNotFoundError,
  UnsupportedKillSwitchScopeError,
} from "@/lib/trader/risk/kill-switch/errors";
import { createKillSwitchResolver } from "@/lib/trader/risk/kill-switch/resolver";
import {
  createPostgresKillSwitchRepository,
  createSqliteKillSwitchRepository,
} from "@/lib/trader/risk/kill-switch/repository-adapters";
import { assertAllowedTransition } from "@/lib/trader/risk/kill-switch/transitions";
import type {
  KillSwitchActor,
  KillSwitchRow,
  KillSwitchScopeKey,
  KillSwitchService,
  KillSwitchServiceDeps,
  KillSwitchTarget,
  KillSwitchTransitionPatch,
  KillSwitchTransitionResult,
} from "@/lib/trader/risk/kill-switch/types";
import {
  assertV0WritableTarget,
  auditOrganizationIdForTarget,
  effectiveCoolingOffMs,
  toKillSwitchView,
} from "@/lib/trader/risk/kill-switch/types";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgKillSwitchExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function assertKeyMatchesTarget(target: KillSwitchTarget, key: KillSwitchScopeKey): void {
  if (target.scopeType !== key.scopeType) {
    throw new UnsupportedKillSwitchScopeError(key.scopeType);
  }
}

async function assertActorAuthorizedForTarget(
  deps: KillSwitchServiceDeps,
  actor: KillSwitchActor,
  target: KillSwitchTarget,
  context?: OrgContext,
): Promise<void> {
  if (target.scopeType === "platform") {
    await deps.assertPlatformKillSwitchAuthority(actor);
    return;
  }

  if (context?.userId && deps.assertOrgMembership) {
    await deps.assertOrgMembership({
      organizationId: requireOrgContext(context.organizationId).organizationId,
      userId: context.userId,
    });
  }
}

function resolveWriteContext(
  target: KillSwitchTarget,
  context: OrgContext | null,
): OrgContext | undefined {
  if (target.scopeType === "platform") {
    return undefined;
  }

  const scoped = requireOrgContext(context?.organizationId ?? target.organizationId);
  if (scoped.organizationId !== target.organizationId) {
    throw new KillSwitchAuthorizationError("KILL_SWITCH_ORG_CONTEXT_MISMATCH");
  }
  return scoped;
}

function buildAuditMetadata(
  row: KillSwitchRow,
  previousState: KillSwitchRow["state"] | null,
  previousStateVersion: number | null,
  actor: KillSwitchActor,
  actingPlatformRole: string | null,
  options?: {
    confirmedAt?: string;
    recoveryActor?: KillSwitchActor;
    eligibleAt?: string | null;
  },
): Record<string, unknown> {
  const effectiveMs = effectiveCoolingOffMs(row.coolingOffMs);
  const eligibleAt =
    options?.eligibleAt !== undefined
      ? options.eligibleAt
      : row.clearingStartedAt !== null
        ? new Date(row.clearingStartedAt.getTime() + effectiveMs).toISOString()
        : null;

  return {
    killSwitchId: row.id,
    scopeType: row.scopeType,
    scopeRef: row.scopeRef,
    switchType: row.switchType,
    origin: row.origin,
    enforcementMode: row.enforcementMode,
    fromState: previousState,
    toState: row.state,
    previousStateVersion,
    stateVersion: row.stateVersion,
    reason: row.reason,
    actorType: actor.actorType,
    actorId: actor.actorId,
    actingPlatformRole,
    clearingStartedAt: row.clearingStartedAt?.toISOString() ?? null,
    coolingOffMs: effectiveMs,
    eligibleAt,
    trippedAt: row.trippedAt?.toISOString() ?? null,
    clearedAt: row.clearedAt?.toISOString() ?? null,
    confirmedAt: options?.confirmedAt ?? null,
    recoveryActor: options?.recoveryActor ?? null,
  };
}

function auditActionForTransition(from: KillSwitchRow["state"] | null, to: KillSwitchRow["state"]) {
  if (from === null || (from === "INACTIVE" && to === "ACTIVE")) {
    return traderAuditActions.killSwitchTripped;
  }
  if (from === "ACTIVE" && to === "ACTIVE") {
    return traderAuditActions.killSwitchEscalated;
  }
  if (from === "ACTIVE" && to === "CLEARING") {
    return traderAuditActions.killSwitchClearingStarted;
  }
  if (from === "CLEARING" && to === "ACTIVE") {
    return traderAuditActions.killSwitchClearCancelled;
  }
  if (from === "CLEARING" && to === "INACTIVE") {
    return traderAuditActions.killSwitchCleared;
  }
  return traderAuditActions.killSwitchTripped;
}

export function createKillSwitchService(deps: KillSwitchServiceDeps): KillSwitchService {
  const resolver = createKillSwitchResolver({
    repository: deps.repository,
    nowMs: deps.nowMs,
  });

  async function applyTransition(
    actor: KillSwitchActor,
    target: KillSwitchTarget,
    key: KillSwitchScopeKey,
    context: OrgContext | undefined,
    existing: KillSwitchRow | null,
    patch: KillSwitchTransitionPatch,
    auditOptions?: {
      confirmedAt?: string;
      recoveryActor?: KillSwitchActor;
      eligibleAt?: string | null;
    },
  ): Promise<KillSwitchTransitionResult> {
    assertV0WritableTarget(target);
    assertKeyMatchesTarget(target, key);
    await assertActorAuthorizedForTarget(deps, actor, target, context);

    const previousState = existing?.state ?? null;
    const previousStateVersion = existing?.stateVersion ?? null;

    if (existing) {
      assertAllowedTransition(existing.state, patch.state);
    }

    const persist = async (): Promise<KillSwitchTransitionResult> => {
      let row: KillSwitchRow;
      if (!existing) {
        if (patch.state !== "ACTIVE") {
          throw new KillSwitchNotFoundError();
        }
        row = await deps.repository.insertRow(target, key, {
          enforcementMode: patch.enforcementMode ?? "REJECT",
          origin: patch.origin ?? "manual",
          reason: patch.reason ?? "",
          state: patch.state,
          clearingStartedAt: patch.clearingStartedAt ?? null,
          coolingOffMs: patch.coolingOffMs ?? null,
          trippedAt: patch.trippedAt ?? new Date(deps.nowMs()),
          clearedAt: patch.clearedAt ?? null,
        });
      } else {
        const updated = await deps.repository.updateRowWithVersion(
          target,
          existing.id,
          existing.stateVersion,
          patch,
        );
        if (!updated) {
          throw new KillSwitchConcurrencyError();
        }
        row = updated;
      }

      const auditId = await deps.writeAudit({
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: auditActionForTransition(previousState, row.state),
        entityType: traderEntityTypes.killSwitch,
        entityId: row.id,
        organizationId: auditOrganizationIdForTarget(target),
        metadata: buildAuditMetadata(
          row,
          previousState,
          previousStateVersion,
          actor,
          null,
          auditOptions,
        ),
      });

      return {
        row: toKillSwitchView(row),
        auditId,
        previousState,
      };
    };

    if (deps.runMutation) {
      return deps.runMutation(persist);
    }
    return persist();
  }

  return {
    getEffectiveState: (context) => resolver.getEffectiveState(context),

    async get(context, target, key) {
      assertV0WritableTarget(target);
      assertKeyMatchesTarget(target, key);
      if (target.scopeType === "organization") {
        requireOrgContext(context.organizationId);
        if (target.organizationId !== context.organizationId) {
          return null;
        }
      }
      const row = await deps.repository.getRowForScope(target, key);
      return row ? toKillSwitchView(row) : null;
    },

    async list(context, filter) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await deps.repository.listRowsForOrg(scoped, filter);
      return rows.map(toKillSwitchView);
    },

    async trip(actor, context, target, key, input) {
      const writeContext = resolveWriteContext(target, context);
      const existing = await deps.repository.getRowForScope(target, key);
      const now = new Date(deps.nowMs());

      if (!existing) {
        return applyTransition(actor, target, key, writeContext, null, {
          state: "ACTIVE",
          enforcementMode: input.enforcementMode,
          origin: input.origin,
          reason: input.reason ?? "",
          coolingOffMs: input.coolingOffMs ?? null,
          trippedAt: now,
          clearedAt: null,
          clearingStartedAt: null,
        });
      }

      if (existing.state === "ACTIVE") {
        throw new KillSwitchConcurrencyError(KILL_SWITCH_ALREADY_ACTIVE);
      }

      if (
        input.expectedStateVersion !== undefined &&
        existing.stateVersion !== input.expectedStateVersion
      ) {
        throw new KillSwitchConcurrencyError();
      }

      return applyTransition(actor, target, key, writeContext, existing, {
        state: "ACTIVE",
        enforcementMode: input.enforcementMode,
        origin: input.origin,
        reason: input.reason ?? existing.reason,
        coolingOffMs: input.coolingOffMs ?? existing.coolingOffMs,
        trippedAt: now,
        clearedAt: null,
        clearingStartedAt: null,
      });
    },

    async escalate(actor, context, target, key, input) {
      const writeContext = resolveWriteContext(target, context);
      const existing = await deps.repository.getRowForScope(target, key);
      if (!existing) {
        throw new KillSwitchNotFoundError();
      }
      if (existing.stateVersion !== input.expectedStateVersion) {
        throw new KillSwitchConcurrencyError();
      }

      return applyTransition(actor, target, key, writeContext, existing, {
        state: "ACTIVE",
        enforcementMode: input.enforcementMode,
        reason: input.reason ?? existing.reason,
        trippedAt: new Date(deps.nowMs()),
      });
    },

    async beginClear(actor, context, target, key, input) {
      const writeContext = resolveWriteContext(target, context);
      const existing = await deps.repository.getRowForScope(target, key);
      if (!existing) {
        throw new KillSwitchNotFoundError();
      }
      if (existing.stateVersion !== input.expectedStateVersion) {
        throw new KillSwitchConcurrencyError();
      }

      return applyTransition(actor, target, key, writeContext, existing, {
        state: "CLEARING",
        reason: input.reason ?? existing.reason,
        clearingStartedAt: new Date(deps.nowMs()),
        coolingOffMs: input.coolingOffMs !== undefined ? input.coolingOffMs : existing.coolingOffMs,
      });
    },

    async cancelClear(actor, context, target, key, input) {
      const writeContext = resolveWriteContext(target, context);
      const existing = await deps.repository.getRowForScope(target, key);
      if (!existing) {
        throw new KillSwitchNotFoundError();
      }
      if (existing.stateVersion !== input.expectedStateVersion) {
        throw new KillSwitchConcurrencyError();
      }

      return applyTransition(actor, target, key, writeContext, existing, {
        state: "ACTIVE",
        reason: input.reason ?? existing.reason,
        clearingStartedAt: null,
      });
    },

    async finalizeClear(actor, context, target, key, input) {
      const writeContext = resolveWriteContext(target, context);
      const existing = await deps.repository.getRowForScope(target, key);
      if (!existing) {
        throw new KillSwitchNotFoundError();
      }
      if (existing.stateVersion !== input.expectedStateVersion) {
        throw new KillSwitchConcurrencyError();
      }

      if (existing.state === "CLEARING") {
        if (!existing.clearingStartedAt) {
          throw new KillSwitchCoolingOffNotElapsedError();
        }
        const effectiveMs = effectiveCoolingOffMs(existing.coolingOffMs);
        if (deps.nowMs() < existing.clearingStartedAt.getTime() + effectiveMs) {
          throw new KillSwitchCoolingOffNotElapsedError();
        }
        if (deps.assertRecoveryConfirmAuthority) {
          await deps.assertRecoveryConfirmAuthority(actor, target);
        }
      }

      const confirmedAt = new Date(deps.nowMs()).toISOString();
      const effectiveMsForAudit = effectiveCoolingOffMs(existing.coolingOffMs);
      const eligibleAtIso =
        existing.clearingStartedAt !== null
          ? new Date(existing.clearingStartedAt.getTime() + effectiveMsForAudit).toISOString()
          : null;

      return applyTransition(
        actor,
        target,
        key,
        writeContext,
        existing,
        {
          state: "INACTIVE",
          reason: input.reason ?? existing.reason,
          clearingStartedAt: null,
          clearedAt: new Date(deps.nowMs()),
        },
        {
          confirmedAt,
          recoveryActor: actor,
          eligibleAt: eligibleAtIso,
        },
      );
    },
  };
}

export function createSqliteKillSwitchService(
  db: WaiaDb,
  deps: Partial<KillSwitchServiceDeps> = {},
): KillSwitchService {
  return createKillSwitchService({
    repository: deps.repository ?? createSqliteKillSwitchRepository(db),
    writeAudit: deps.writeAudit ?? ((input) => writeAuditLogSqlite(db, input)),
    nowMs: deps.nowMs ?? (() => Date.now()),
    assertOrgMembership:
      deps.assertOrgMembership ??
      ((context) => {
        assertOrgMembershipSqlite(db, context);
      }),
    assertPlatformKillSwitchAuthority:
      deps.assertPlatformKillSwitchAuthority ??
      ((actor) => {
        assertPlatformKillSwitchAuthoritySqlite(db, actor);
      }),
    assertRecoveryConfirmAuthority:
      deps.assertRecoveryConfirmAuthority ??
      ((actor, target) => {
        assertRecoveryConfirmAuthoritySqlite(db, actor, target);
      }),
  });
}

export function createPostgresKillSwitchService(
  ex: PgKillSwitchExecutor,
  deps: Partial<KillSwitchServiceDeps> = {},
): KillSwitchService {
  return createKillSwitchService({
    repository: deps.repository ?? createPostgresKillSwitchRepository(ex),
    writeAudit: deps.writeAudit ?? ((input) => writeAuditLogPostgres(ex, input)),
    nowMs: deps.nowMs ?? (() => Date.now()),
    assertOrgMembership:
      deps.assertOrgMembership ??
      (async (context) => {
        await assertOrgMembershipPostgres(ex, context);
      }),
    assertPlatformKillSwitchAuthority:
      deps.assertPlatformKillSwitchAuthority ??
      (async (actor) => {
        await assertPlatformKillSwitchAuthorityPostgres(ex, actor);
      }),
    assertRecoveryConfirmAuthority:
      deps.assertRecoveryConfirmAuthority ??
      (async (actor, target) => {
        await assertRecoveryConfirmAuthorityPostgres(ex, actor, target);
      }),
    runMutation: deps.runMutation ?? ((fn) => fn()),
  });
}
