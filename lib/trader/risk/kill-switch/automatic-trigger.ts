import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";
import { isAlreadyActiveError } from "@/lib/trader/risk/kill-switch/errors";
import {
  createPostgresKillSwitchService,
  createSqliteKillSwitchService,
} from "@/lib/trader/risk/kill-switch/kill-switch-service";
import type {
  KillSwitchActor,
  KillSwitchEnforcementMode,
  KillSwitchScopeKey,
  KillSwitchService,
  KillSwitchTarget,
  KillSwitchType,
} from "@/lib/trader/risk/kill-switch/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import { emitKillSwitchDataQualityCounter } from "@/lib/trader/risk/risk-telemetry";

export type AnomalySwitchType = Extract<
  KillSwitchType,
  "ABNORMAL_SLIPPAGE" | "UNKNOWN_POSITION" | "STALE_STATE"
>;

export type KillSwitchTriggerBase = {
  target: KillSwitchTarget;
  enforcementMode?: KillSwitchEnforcementMode;
  detail?: string;
};

export type KillSwitchTriggerSignal =
  | ({ category: "mismatch" } & KillSwitchTriggerBase)
  | ({ category: "anomaly"; anomalyType: AnomalySwitchType } & KillSwitchTriggerBase)
  | ({ category: "data_quality" } & KillSwitchTriggerBase)
  | ({ category: "control_plane_loss" } & KillSwitchTriggerBase);

export type TriggerOutcome =
  | {
      status: "tripped";
      switchType: KillSwitchType;
      killSwitchId: string;
      stateVersion: number;
      auditId: string;
    }
  | { status: "already_active"; switchType: KillSwitchType };

export type KillSwitchTriggerPort = {
  activate(signal: KillSwitchTriggerSignal): Promise<TriggerOutcome>;
};

export type AutomaticTriggerDispatcher = KillSwitchTriggerPort;

export type KillSwitchTriggerPlan = {
  target: KillSwitchTarget;
  key: KillSwitchScopeKey;
  enforcementMode: KillSwitchEnforcementMode;
  reason: string;
  switchType: KillSwitchType;
};

export const CANONICAL_AUTO_TRIGGER_REASONS = [
  "auto:mismatch",
  "auto:data_quality",
  "auto:control_plane_loss",
  "auto:anomaly:ABNORMAL_SLIPPAGE",
  "auto:anomaly:UNKNOWN_POSITION",
  "auto:anomaly:STALE_STATE",
] as const;

export type CanonicalAutoTriggerReason = (typeof CANONICAL_AUTO_TRIGGER_REASONS)[number];

export const TRUSTED_AUTOMATIC_TRIGGER_ACTOR: KillSwitchActor = {
  actorType: "service",
  actorId: null,
};

const DEFAULT_ENFORCEMENT_BY_SWITCH_TYPE: Record<KillSwitchType, KillSwitchEnforcementMode> = {
  RECON_MISMATCH: "STOP_ACCOUNT",
  CONTROL_PLANE_LOSS: "STOP_ACCOUNT",
  UNKNOWN_POSITION: "STOP_ACCOUNT",
  ABNORMAL_SLIPPAGE: "REJECT",
  STALE_STATE: "CLOSE_ONLY",
  DATA_QUALITY: "REJECT",
  EMERGENCY_STOP: "STOP_ACCOUNT",
  PAUSE: "REJECT",
  CLOSE_ONLY: "CLOSE_ONLY",
};

function switchTypeForSignal(signal: KillSwitchTriggerSignal): KillSwitchType {
  switch (signal.category) {
    case "mismatch":
      return "RECON_MISMATCH";
    case "data_quality":
      return "DATA_QUALITY";
    case "control_plane_loss":
      return "CONTROL_PLANE_LOSS";
    case "anomaly":
      return signal.anomalyType;
    default: {
      const _exhaustive: never = signal;
      return _exhaustive;
    }
  }
}

function canonicalReasonForSignal(signal: KillSwitchTriggerSignal): CanonicalAutoTriggerReason {
  switch (signal.category) {
    case "mismatch":
      return "auto:mismatch";
    case "data_quality":
      return "auto:data_quality";
    case "control_plane_loss":
      return "auto:control_plane_loss";
    case "anomaly":
      return `auto:anomaly:${signal.anomalyType}` as CanonicalAutoTriggerReason;
    default: {
      const _exhaustive: never = signal;
      return _exhaustive;
    }
  }
}

export function deriveContextFromTriggerTarget(target: KillSwitchTarget): OrgContext | null {
  if (target.scopeType === "platform") {
    return null;
  }
  return { organizationId: target.organizationId };
}

export function triggerSignalToSwitchPlan(signal: KillSwitchTriggerSignal): KillSwitchTriggerPlan {
  const switchType = switchTypeForSignal(signal);
  const target = signal.target;

  return {
    target,
    switchType,
    key: {
      scopeType: target.scopeType,
      scopeRef: null,
      switchType,
    },
    enforcementMode: signal.enforcementMode ?? DEFAULT_ENFORCEMENT_BY_SWITCH_TYPE[switchType],
    reason: canonicalReasonForSignal(signal),
  };
}

export type AutomaticTriggerDispatcherDeps = {
  killSwitchService: KillSwitchService;
  actor: KillSwitchActor;
  riskTelemetrySink?: WaiaTraderTelemetrySink;
};

export function createAutomaticTriggerDispatcher(
  deps: AutomaticTriggerDispatcherDeps,
): AutomaticTriggerDispatcher {
  return {
    async activate(signal) {
      const plan = triggerSignalToSwitchPlan(signal);
      const context = deriveContextFromTriggerTarget(signal.target);

      if (signal.category === "data_quality" && context !== null) {
        emitKillSwitchDataQualityCounter(
          { organizationId: context.organizationId },
          deps.riskTelemetrySink,
        );
      }

      try {
        const result = await deps.killSwitchService.trip(
          deps.actor,
          context,
          plan.target,
          plan.key,
          {
            enforcementMode: plan.enforcementMode,
            origin: "automatic",
            reason: plan.reason,
          },
        );

        return {
          status: "tripped",
          switchType: plan.switchType,
          killSwitchId: result.row.id,
          stateVersion: result.row.stateVersion,
          auditId: result.auditId,
        };
      } catch (error) {
        if (isAlreadyActiveError(error)) {
          return {
            status: "already_active",
            switchType: plan.switchType,
          };
        }
        throw error;
      }
    },
  };
}

type PgAutomaticTriggerExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export type AutomaticTriggerDispatcherFactoryDeps = {
  killSwitchService?: KillSwitchService;
  actor?: KillSwitchActor;
  riskTelemetrySink?: WaiaTraderTelemetrySink;
};

export function createSqliteAutomaticTriggerDispatcher(
  db: WaiaDb,
  deps: AutomaticTriggerDispatcherFactoryDeps = {},
): AutomaticTriggerDispatcher {
  return createAutomaticTriggerDispatcher({
    killSwitchService: deps.killSwitchService ?? createSqliteKillSwitchService(db),
    actor: deps.actor ?? TRUSTED_AUTOMATIC_TRIGGER_ACTOR,
    riskTelemetrySink: deps.riskTelemetrySink,
  });
}

export function createPostgresAutomaticTriggerDispatcher(
  ex: PgAutomaticTriggerExecutor,
  deps: AutomaticTriggerDispatcherFactoryDeps = {},
): AutomaticTriggerDispatcher {
  return createAutomaticTriggerDispatcher({
    killSwitchService: deps.killSwitchService ?? createPostgresKillSwitchService(ex),
    actor: deps.actor ?? TRUSTED_AUTOMATIC_TRIGGER_ACTOR,
    riskTelemetrySink: deps.riskTelemetrySink,
  });
}
