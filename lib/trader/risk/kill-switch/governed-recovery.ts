import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  KillSwitchNotFoundError,
  KillSwitchValidationError,
} from "@/lib/trader/risk/kill-switch/errors";
import {
  createPostgresKillSwitchService,
  createSqliteKillSwitchService,
} from "@/lib/trader/risk/kill-switch/kill-switch-service";
import type {
  GovernedRecoveryService,
  KillSwitchScopeKey,
  KillSwitchService,
  KillSwitchTarget,
  KillSwitchView,
  RecoveryPreview,
} from "@/lib/trader/risk/kill-switch/types";
import { assertV0WritableTarget, effectiveCoolingOffMs } from "@/lib/trader/risk/kill-switch/types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

export type GovernedRecoveryServiceDeps = {
  killSwitchService: KillSwitchService;
  nowMs: () => number;
};

function validateCoolingOffMsOverride(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new KillSwitchValidationError("KILL_SWITCH_COOLING_OFF_MS_INVALID");
  }
  return value;
}

export function buildRecoveryPreview(row: KillSwitchView, nowMs: number): RecoveryPreview {
  const effectiveMs = effectiveCoolingOffMs(row.coolingOffMs);
  const eligibleAt =
    row.clearingStartedAt !== null ? new Date(row.clearingStartedAt.getTime() + effectiveMs) : null;
  const remainingMs = eligibleAt ? Math.max(0, eligibleAt.getTime() - nowMs) : 0;

  return {
    switchType: row.switchType,
    scopeType: row.scopeType,
    scopeRef: row.scopeRef,
    state: row.state,
    origin: row.origin,
    reason: row.reason,
    clearingStartedAt: row.clearingStartedAt,
    coolingOffMs: effectiveMs,
    eligibleAt,
    remainingMs,
    confirmable: row.state === "CLEARING" && remainingMs === 0,
    stateVersion: row.stateVersion,
  };
}

export function createGovernedRecoveryService(
  deps: GovernedRecoveryServiceDeps,
): GovernedRecoveryService {
  const { killSwitchService, nowMs } = deps;

  async function readSwitch(
    context: OrgContext | null,
    target: KillSwitchTarget,
    key: KillSwitchScopeKey,
  ): Promise<KillSwitchView | null> {
    assertV0WritableTarget(target);
    if (target.scopeType === "organization") {
      const scoped = requireOrgContext(context?.organizationId ?? target.organizationId);
      return killSwitchService.get(scoped, target, key);
    }
    return killSwitchService.get({ organizationId: "platform" }, target, key);
  }

  return {
    async requestClear(actor, context, target, key, input) {
      const coolingOffMs = validateCoolingOffMsOverride(input.coolingOffMs);
      return killSwitchService.beginClear(actor, context, target, key, {
        reason: input.reason,
        expectedStateVersion: input.expectedStateVersion,
        coolingOffMs,
      });
    },

    async previewRecovery(context, target, key) {
      const row = await readSwitch(context, target, key);
      if (!row) {
        throw new KillSwitchNotFoundError();
      }
      return buildRecoveryPreview(row, nowMs());
    },

    async confirmClear(actor, context, target, key, input) {
      return killSwitchService.finalizeClear(actor, context, target, key, input);
    },

    async cancelClear(actor, context, target, key, input) {
      return killSwitchService.cancelClear(actor, context, target, key, input);
    },
  };
}

export type GovernedRecoveryFactoryDeps = {
  nowMs?: () => number;
};

export function createSqliteGovernedRecoveryService(
  db: WaiaDb,
  deps: GovernedRecoveryFactoryDeps = {},
): GovernedRecoveryService {
  const nowMs = deps.nowMs ?? (() => Date.now());
  return createGovernedRecoveryService({
    killSwitchService: createSqliteKillSwitchService(db, { nowMs }),
    nowMs,
  });
}

type PgGovernedRecoveryExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export function createPostgresGovernedRecoveryService(
  ex: PgGovernedRecoveryExecutor,
  deps: GovernedRecoveryFactoryDeps = {},
): GovernedRecoveryService {
  const nowMs = deps.nowMs ?? (() => Date.now());
  return createGovernedRecoveryService({
    killSwitchService: createPostgresKillSwitchService(ex, { nowMs }),
    nowMs,
  });
}
