import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  emitTraderTelemetry,
  type WaiaTraderTelemetrySink,
} from "@/lib/observability/waia-trader-telemetry";
import { isAlreadyActiveError } from "@/lib/trader/risk/kill-switch/errors";
import { createPostgresKillSwitchService } from "@/lib/trader/risk/kill-switch/kill-switch-service";
import { TRUSTED_AUTOMATIC_TRIGGER_ACTOR } from "@/lib/trader/risk/kill-switch/automatic-trigger";

/**
 * `kill_state_telemetry` is only an event field. It does not insert
 * `trader_kill_switches` and it does not project `kill_state` onto risk accounts.
 * `kill_switch_write` reports that row write.
 */
export const LIVE_CREDENTIAL_KILL_STATE_TELEMETRY = "TRIPPED" as const;

export const CREDENTIAL_GATE_KILL_REASONS = [
  "CREDENTIAL_REQUIRED",
  "CREDENTIAL_NOT_TRADE_SCOPED",
] as const;

export type CredentialGateKillReason = (typeof CREDENTIAL_GATE_KILL_REASONS)[number];

export type CredentialKillSwitchWrite = "WRITTEN" | "ALREADY_ACTIVE" | "NOT_ATTEMPTED";

type KillSwitchExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update" | "execute"> &
  Partial<Pick<WaiaPostgresDb, "transaction">>;

export function isCredentialGateKillReason(reason: string): reason is CredentialGateKillReason {
  return (CREDENTIAL_GATE_KILL_REASONS as readonly string[]).includes(reason);
}

export async function emitCredentialGateKillTelemetry(input: {
  organizationId: string;
  outcome: string;
  errorClass: string;
  killSwitchWrite: CredentialKillSwitchWrite;
  sink?: WaiaTraderTelemetrySink;
}): Promise<void> {
  emitTraderTelemetry(
    {
      event: "waia_trader_event",
      kind: "execution",
      organization_id: input.organizationId,
      outcome: input.outcome,
      severity: "critical",
      kill_state_telemetry: LIVE_CREDENTIAL_KILL_STATE_TELEMETRY,
      kill_switch_write: input.killSwitchWrite,
      error_class: input.errorClass,
    },
    input.sink,
  );
}

/**
 * Inserts an organization EMERGENCY_STOP and projects it onto risk accounts.
 * `joinCurrentTransaction` keeps the write on the caller's open transaction
 * so it does not wait on locks that transaction already holds.
 */
export async function writeOrganizationCredentialKillSwitchPostgres(
  db: KillSwitchExecutor,
  organizationId: string,
  reason: CredentialGateKillReason,
  options?: { joinCurrentTransaction?: boolean },
): Promise<Exclude<CredentialKillSwitchWrite, "NOT_ATTEMPTED">> {
  const executor = options?.joinCurrentTransaction ? hideNestedTransaction(db) : db;
  const service = createPostgresKillSwitchService(executor);
  try {
    await service.trip(
      TRUSTED_AUTOMATIC_TRIGGER_ACTOR,
      { organizationId },
      { scopeType: "organization", organizationId },
      { scopeType: "organization", scopeRef: null, switchType: "EMERGENCY_STOP" },
      {
        enforcementMode: "STOP_ACCOUNT",
        origin: "automatic",
        reason,
      },
    );
    return "WRITTEN";
  } catch (error) {
    if (isAlreadyActiveError(error)) return "ALREADY_ACTIVE";
    throw error;
  }
}

function hideNestedTransaction(db: KillSwitchExecutor): KillSwitchExecutor {
  return new Proxy(db, {
    has(target, key) {
      if (key === "transaction") return false;
      return key in target;
    },
    get(target, key) {
      if (key === "transaction") return undefined;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
