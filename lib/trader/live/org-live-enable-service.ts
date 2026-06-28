import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { TraderOrgLiveEnableEventType } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeAuditLogPostgres, writeAuditLogSqlite } from "@/lib/waia-core/audit/write";
import {
  REQUIRED_ORG_LIVE_ENABLE_ACK,
  effectiveOrgLiveEnableCoolingOffMs,
} from "@/lib/trader/live/config";
import {
  OrgLiveEnableAckRequiredError,
  OrgLiveEnableConcurrencyError,
  OrgLiveEnableConflictError,
  OrgLiveEnableCoolingOffNotElapsedError,
  OrgLiveEnableValidationError,
} from "@/lib/trader/live/errors";
import {
  appendOrgLiveEnableEventAndProjectionPostgres,
  getOrgLiveEnableStatePostgres,
  listOrgLiveEnableEventsPostgres,
} from "@/lib/trader/live/repository-postgres";
import {
  appendOrgLiveEnableEventAndProjectionSqlite,
  getOrgLiveEnableStateSqlite,
  listOrgLiveEnableEventsSqlite,
} from "@/lib/trader/live/repository-sqlite";
import {
  buildOrgLiveEnableEventPayload,
  hashOperatorAckPhrase,
} from "@/lib/trader/live/serialize-org-live-enable";
import type {
  ConfirmOrgLiveEnableInput,
  OrgLiveEnableActor,
  OrgLiveEnablePreview,
  OrgLiveEnableTransitionInput,
  OrgLiveEnableView,
  RequestOrgLiveEnableInput,
} from "@/lib/trader/live/types";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export type OrgLiveEnableRepository = {
  getState(context: OrgContext): Promise<OrgLiveEnableView | null>;
  listEvents(context: OrgContext): Promise<ReturnType<typeof listOrgLiveEnableEventsSqlite>>;
  appendEventAndProjection(
    context: OrgContext,
    payload: Parameters<typeof appendOrgLiveEnableEventAndProjectionSqlite>[2],
    projection: OrgLiveEnableView,
  ): Promise<ReturnType<typeof appendOrgLiveEnableEventAndProjectionSqlite>>;
};

export type OrgLiveEnableServiceDeps = {
  repository: OrgLiveEnableRepository;
  nowMs: () => number;
  writeAudit: (
    actor: OrgLiveEnableActor,
    organizationId: string,
    action: string,
    state: OrgLiveEnableView,
    metadata?: Record<string, unknown>,
  ) => Promise<string> | string;
};

function assertValidNotionalCap(maxNotionalCap: string): void {
  if (compareDecimal(maxNotionalCap, "0") <= 0) {
    throw new OrgLiveEnableValidationError(
      "ORG_LIVE_ENABLE_CAP_INVALID",
      "maxNotionalCap must be positive",
    );
  }
}

function assertRequestAllowed(current: OrgLiveEnableView | null): void {
  if (current?.state === "ENABLED") {
    throw new OrgLiveEnableConflictError(
      "ORG_LIVE_ENABLE_ALREADY_ENABLED",
      "Organization live-enable is already ENABLED",
    );
  }
  if (current?.state === "REQUESTED" || current?.state === "COOLING_OFF") {
    throw new OrgLiveEnableConflictError(
      "ORG_LIVE_ENABLE_IN_PROGRESS",
      "Organization live-enable request is already in progress",
    );
  }
}

function mapRepositoryError(error: unknown): never {
  if (error instanceof Error && error.message === "ORG_LIVE_ENABLE_STATE_VERSION_MISMATCH") {
    throw new OrgLiveEnableConcurrencyError();
  }
  throw error;
}

function buildPreview(state: OrgLiveEnableView | null, nowMs: number): OrgLiveEnablePreview {
  const coolingOffMs = effectiveOrgLiveEnableCoolingOffMs(undefined);
  const eligibleAt = state?.coolingOffEndsAt ?? null;
  const remainingMs = eligibleAt ? Math.max(0, eligibleAt.getTime() - nowMs) : 0;
  return {
    state,
    coolingOffMs,
    eligibleAt,
    remainingMs,
    confirmable: state?.state === "REQUESTED",
    enableEligible: state?.state === "COOLING_OFF" && remainingMs === 0,
  };
}

async function appendTransition(
  deps: OrgLiveEnableServiceDeps,
  actor: OrgLiveEnableActor,
  context: OrgContext,
  current: OrgLiveEnableView | null,
  input: {
    eventType: TraderOrgLiveEnableEventType;
    nextState: OrgLiveEnableView["state"];
    maxNotionalCap: string;
    reason?: string | null;
    requestedAt?: Date | null;
    coolingOffEndsAt?: Date | null;
    enabledAt?: Date | null;
    disabledAt?: Date | null;
    operatorAckPhraseHash?: string | null;
    expectedStateVersion?: number;
  },
): Promise<OrgLiveEnableView> {
  const scoped = requireOrgContext(context.organizationId);
  const now = new Date(deps.nowMs());
  const events = await deps.repository.listEvents(scoped);
  const lastEvent = events.at(-1) ?? null;
  const seq = (lastEvent?.seq ?? 0) + 1;
  const nextStateVersion =
    current == null
      ? 1
      : input.expectedStateVersion != null
        ? input.expectedStateVersion + 1
        : current.stateVersion + 1;

  if (
    current != null &&
    input.expectedStateVersion != null &&
    current.stateVersion !== input.expectedStateVersion
  ) {
    throw new OrgLiveEnableConcurrencyError();
  }

  const eventPayload = buildOrgLiveEnableEventPayload({
    organizationId: scoped.organizationId,
    seq,
    eventType: input.eventType,
    maxNotionalCap: input.maxNotionalCap,
    reason: input.reason ?? null,
    actorType: actor.actorType,
    actorId: actor.actorId,
    prevEventDigest: lastEvent?.recordContentDigest ?? null,
  });

  const projection: OrgLiveEnableView = {
    organizationId: scoped.organizationId,
    state: input.nextState,
    maxNotionalCap: input.maxNotionalCap,
    requestedAt: input.requestedAt ?? current?.requestedAt ?? null,
    coolingOffEndsAt: input.coolingOffEndsAt ?? current?.coolingOffEndsAt ?? null,
    enabledAt: input.enabledAt ?? current?.enabledAt ?? null,
    disabledAt: input.disabledAt ?? current?.disabledAt ?? null,
    operatorAckPhraseHash: input.operatorAckPhraseHash ?? current?.operatorAckPhraseHash ?? null,
    stateVersion: nextStateVersion,
    lastEventSeq: seq,
    lastEventDigest: eventPayload.recordContentDigest,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };

  try {
    await deps.repository.appendEventAndProjection(scoped, eventPayload, projection);
  } catch (error) {
    mapRepositoryError(error);
  }

  const updated = await deps.repository.getState(scoped);
  if (!updated) {
    throw new Error("[trader/live] org live-enable projection missing after transition");
  }
  return updated;
}

export function createOrgLiveEnableService(deps: OrgLiveEnableServiceDeps) {
  const { nowMs, writeAudit } = deps;

  return {
    async getState(context: OrgContext): Promise<OrgLiveEnableView | null> {
      return deps.repository.getState(requireOrgContext(context.organizationId));
    },

    async preview(context: OrgContext): Promise<OrgLiveEnablePreview> {
      const state = await deps.repository.getState(requireOrgContext(context.organizationId));
      return buildPreview(state, nowMs());
    },

    async requestEnable(
      actor: OrgLiveEnableActor,
      context: OrgContext,
      input: RequestOrgLiveEnableInput,
    ): Promise<OrgLiveEnableView> {
      const scoped = requireOrgContext(context.organizationId);
      assertValidNotionalCap(input.maxNotionalCap);
      const current = await deps.repository.getState(scoped);
      assertRequestAllowed(current);
      const now = new Date(nowMs());

      const updated = await appendTransition(deps, actor, scoped, current, {
        eventType: "REQUESTED",
        nextState: "REQUESTED",
        maxNotionalCap: input.maxNotionalCap,
        requestedAt: now,
        coolingOffEndsAt: null,
        enabledAt: null,
        disabledAt: null,
        operatorAckPhraseHash: null,
        expectedStateVersion: current?.stateVersion,
      });

      await writeAudit(
        actor,
        scoped.organizationId,
        traderAuditActions.orgLiveEnableRequested,
        updated,
        {
          maxNotionalCap: input.maxNotionalCap,
        },
      );
      return updated;
    },

    async confirmEnable(
      actor: OrgLiveEnableActor,
      context: OrgContext,
      input: ConfirmOrgLiveEnableInput,
    ): Promise<OrgLiveEnableView> {
      const scoped = requireOrgContext(context.organizationId);
      const current = await deps.repository.getState(scoped);
      if (!current || current.state !== "REQUESTED") {
        throw new OrgLiveEnableValidationError(
          "ORG_LIVE_ENABLE_CONFIRM_NOT_ALLOWED",
          "Org live-enable can only be confirmed from REQUESTED",
        );
      }
      if (input.ackPhrase !== REQUIRED_ORG_LIVE_ENABLE_ACK) {
        throw new OrgLiveEnableAckRequiredError();
      }

      const coolingOffMs = effectiveOrgLiveEnableCoolingOffMs(undefined);
      const now = new Date(nowMs());
      const coolingOffEndsAt = new Date(now.getTime() + coolingOffMs);
      const ackHash = hashOperatorAckPhrase(input.ackPhrase);

      const updated = await appendTransition(deps, actor, scoped, current, {
        eventType: "CONFIRMED",
        nextState: "COOLING_OFF",
        maxNotionalCap: current.maxNotionalCap,
        requestedAt: current.requestedAt,
        coolingOffEndsAt,
        operatorAckPhraseHash: ackHash,
        expectedStateVersion: input.expectedStateVersion,
      });

      await writeAudit(
        actor,
        scoped.organizationId,
        traderAuditActions.orgLiveEnableConfirmed,
        updated,
        {
          coolingOffMs,
          coolingOffEndsAt: coolingOffEndsAt.toISOString(),
        },
      );
      return updated;
    },

    async markEnabled(
      actor: OrgLiveEnableActor,
      context: OrgContext,
      input: OrgLiveEnableTransitionInput,
    ): Promise<OrgLiveEnableView> {
      const scoped = requireOrgContext(context.organizationId);
      const current = await deps.repository.getState(scoped);
      if (!current || current.state !== "COOLING_OFF") {
        throw new OrgLiveEnableValidationError(
          "ORG_LIVE_ENABLE_MARK_ENABLED_NOT_ALLOWED",
          "Org live-enable can only be marked ENABLED from COOLING_OFF",
        );
      }

      const preview = buildPreview(current, nowMs());
      if (!preview.enableEligible) {
        throw new OrgLiveEnableCoolingOffNotElapsedError();
      }

      const now = new Date(nowMs());
      const updated = await appendTransition(deps, actor, scoped, current, {
        eventType: "ENABLED",
        nextState: "ENABLED",
        maxNotionalCap: current.maxNotionalCap,
        requestedAt: current.requestedAt,
        coolingOffEndsAt: current.coolingOffEndsAt,
        enabledAt: now,
        disabledAt: null,
        operatorAckPhraseHash: current.operatorAckPhraseHash,
        expectedStateVersion: input.expectedStateVersion,
      });

      await writeAudit(
        actor,
        scoped.organizationId,
        traderAuditActions.orgLiveEnableEnabled,
        updated,
      );
      return updated;
    },

    async disable(
      actor: OrgLiveEnableActor,
      context: OrgContext,
      input: OrgLiveEnableTransitionInput,
    ): Promise<OrgLiveEnableView> {
      const scoped = requireOrgContext(context.organizationId);
      const current = await deps.repository.getState(scoped);
      if (!current || current.state !== "ENABLED") {
        throw new OrgLiveEnableValidationError(
          "ORG_LIVE_ENABLE_DISABLE_NOT_ALLOWED",
          "Org live-enable can only be disabled from ENABLED",
        );
      }

      const now = new Date(nowMs());
      const updated = await appendTransition(deps, actor, scoped, current, {
        eventType: "DISABLED",
        nextState: "DISABLED",
        maxNotionalCap: current.maxNotionalCap,
        requestedAt: current.requestedAt,
        coolingOffEndsAt: current.coolingOffEndsAt,
        enabledAt: current.enabledAt,
        disabledAt: now,
        operatorAckPhraseHash: current.operatorAckPhraseHash,
        reason: input.reason ?? null,
        expectedStateVersion: input.expectedStateVersion,
      });

      await writeAudit(
        actor,
        scoped.organizationId,
        traderAuditActions.orgLiveEnableDisabled,
        updated,
        {
          reason: input.reason ?? null,
        },
      );
      return updated;
    },

    async cancel(
      actor: OrgLiveEnableActor,
      context: OrgContext,
      input: OrgLiveEnableTransitionInput,
    ): Promise<OrgLiveEnableView> {
      const scoped = requireOrgContext(context.organizationId);
      const current = await deps.repository.getState(scoped);
      if (!current || (current.state !== "REQUESTED" && current.state !== "COOLING_OFF")) {
        throw new OrgLiveEnableValidationError(
          "ORG_LIVE_ENABLE_CANCEL_NOT_ALLOWED",
          "Org live-enable can only be cancelled from REQUESTED or COOLING_OFF",
        );
      }

      const now = new Date(nowMs());
      const updated = await appendTransition(deps, actor, scoped, current, {
        eventType: "CANCELLED",
        nextState: "CANCELLED",
        maxNotionalCap: current.maxNotionalCap,
        requestedAt: current.requestedAt,
        coolingOffEndsAt: current.coolingOffEndsAt,
        enabledAt: null,
        disabledAt: now,
        operatorAckPhraseHash: current.operatorAckPhraseHash,
        reason: input.reason ?? null,
        expectedStateVersion: input.expectedStateVersion,
      });

      await writeAudit(
        actor,
        scoped.organizationId,
        traderAuditActions.orgLiveEnableCancelled,
        updated,
      );
      return updated;
    },
  };
}

export type OrgLiveEnableService = ReturnType<typeof createOrgLiveEnableService>;

export function createSqliteOrgLiveEnableRepository(db: WaiaDb): OrgLiveEnableRepository {
  return {
    getState: async (context) => getOrgLiveEnableStateSqlite(db, context),
    listEvents: async (context) => listOrgLiveEnableEventsSqlite(db, context),
    appendEventAndProjection: async (context, payload, projection) =>
      appendOrgLiveEnableEventAndProjectionSqlite(db, context, payload, projection),
  };
}

export function createPostgresOrgLiveEnableRepository(ex: PgExecutor): OrgLiveEnableRepository {
  return {
    getState: (context) => getOrgLiveEnableStatePostgres(ex, context),
    listEvents: (context) => listOrgLiveEnableEventsPostgres(ex, context),
    appendEventAndProjection: (context, payload, projection) =>
      appendOrgLiveEnableEventAndProjectionPostgres(ex, context, payload, projection),
  };
}

export function createSqliteOrgLiveEnableService(
  db: WaiaDb,
  deps: { nowMs?: () => number } = {},
): OrgLiveEnableService {
  const now = deps.nowMs ?? (() => Date.now());
  return createOrgLiveEnableService({
    repository: createSqliteOrgLiveEnableRepository(db),
    nowMs: now,
    writeAudit: (actor, organizationId, action, state, metadata) =>
      writeAuditLogSqlite(db, {
        actorType: actor.actorType,
        actorId: actor.actorId,
        action,
        entityType: traderEntityTypes.orgLiveEnable,
        entityId: state.organizationId,
        organizationId,
        metadata: {
          state: state.state,
          maxNotionalCap: state.maxNotionalCap,
          ...metadata,
        },
      }),
  });
}

export function createPostgresOrgLiveEnableService(
  ex: PgExecutor,
  deps: { nowMs?: () => number } = {},
): OrgLiveEnableService {
  const now = deps.nowMs ?? (() => Date.now());
  return createOrgLiveEnableService({
    repository: createPostgresOrgLiveEnableRepository(ex),
    nowMs: now,
    writeAudit: async (actor, organizationId, action, state, metadata) =>
      writeAuditLogPostgres(ex, {
        actorType: actor.actorType,
        actorId: actor.actorId,
        action,
        entityType: traderEntityTypes.orgLiveEnable,
        entityId: state.organizationId,
        organizationId,
        metadata: {
          state: state.state,
          maxNotionalCap: state.maxNotionalCap,
          ...metadata,
        },
      }),
  });
}
