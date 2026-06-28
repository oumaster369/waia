import { createHash } from "node:crypto";

import type { AlertEnvelope, AlertType } from "@/lib/observability/alerting/types";

const KILL_SWITCH_DATA_QUALITY_CODE = "auto:data_quality";

const PAYMENT_WATCHER_FAILURE_PHASES = new Set(["cycle_error", "deps_error"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readScalarExtensions(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
): Record<string, string | number | boolean | null> {
  const extensions: Record<string, string | number | boolean | null> = {};
  for (const key of allowedKeys) {
    const value = record[key];
    if (value === undefined) {
      continue;
    }
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      extensions[key] = value;
    }
  }
  return extensions;
}

export function tryParseJsonLine(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function buildAlertFingerprint(input: {
  sourceStream: string;
  alertType: string;
  organizationId: string | null;
  outcome: string;
  escalationKind?: string | null;
}): string {
  const orgKey = input.organizationId ?? "platform";
  const escalation = input.escalationKind ?? "";
  const raw = `${input.sourceStream}|${input.alertType}|${orgKey}|${input.outcome}|${escalation}`;
  return createHash("sha256").update(raw).digest("hex");
}

function classifyTraderEvent(record: Record<string, unknown>): AlertEnvelope | null {
  if (record.event !== "waia_trader_event") {
    return null;
  }
  if (record.severity !== "critical") {
    return null;
  }

  const kind = readString(record, "kind");
  const outcome = readString(record, "outcome");
  if (!kind || !outcome) {
    return null;
  }

  const organizationId = readString(record, "organization_id") ?? null;
  const observedAt = new Date().toISOString();
  let alertType: AlertType | null = null;

  if (kind === "execution" && outcome === "conflict") {
    alertType = "duplicate_order_risk";
  } else if (kind === "reconciliation") {
    alertType = "reconciliation_mismatch";
  } else if (
    kind === "counter" &&
    record.domain === "kill_switch" &&
    record.code === KILL_SWITCH_DATA_QUALITY_CODE
  ) {
    alertType = "data_quality_breach";
  } else if (kind === "paper_loop") {
    if (record.risk_outcome === "STOP_ACCOUNT") {
      alertType = "drawdown_stop_account";
    } else {
      alertType = "paper_loop_critical";
    }
  }

  if (alertType === null) {
    return null;
  }

  const extensions = readScalarExtensions(record, [
    "escalation_kind",
    "execution_mode",
    "target_kind",
    "risk_outcome",
    "reconciliation_classification",
  ]);

  return {
    alertType,
    sourceStream: "waia_trader_event",
    organizationId,
    sourceKind: kind,
    outcome,
    fingerprint: buildAlertFingerprint({
      sourceStream: "waia_trader_event",
      alertType,
      organizationId,
      outcome,
      escalationKind: readString(record, "escalation_kind") ?? null,
    }),
    observedAt,
    extensions,
  };
}

function classifyPaymentWatcherEvent(record: Record<string, unknown>): AlertEnvelope | null {
  if (record.event !== "waia_payment_watcher") {
    return null;
  }

  const phase = readString(record, "phase");
  if (!phase) {
    return null;
  }

  const reason = readString(record, "reason");
  const isFailure =
    PAYMENT_WATCHER_FAILURE_PHASES.has(phase) ||
    (phase === "cycle_noop" && reason === "provider_error");

  if (!isFailure) {
    return null;
  }

  const outcome = phase === "cycle_noop" ? "provider_error" : phase;

  return {
    alertType: "payment_watcher_failure",
    sourceStream: "waia_payment_watcher",
    organizationId: null,
    sourceKind: phase,
    outcome,
    fingerprint: buildAlertFingerprint({
      sourceStream: "waia_payment_watcher",
      alertType: "payment_watcher_failure",
      organizationId: null,
      outcome,
    }),
    observedAt: new Date().toISOString(),
    extensions: reason ? { reason } : {},
  };
}

function classifyRuntimeRouteEvent(record: Record<string, unknown>): AlertEnvelope | null {
  if (record.event !== "waia_runtime_route") {
    return null;
  }

  if (record.route !== "health_payment_watcher" || record.outcome !== "stale") {
    return null;
  }

  return {
    alertType: "payment_watcher_offline",
    sourceStream: "waia_runtime_route",
    organizationId: null,
    sourceKind: "health_payment_watcher",
    outcome: "stale",
    fingerprint: buildAlertFingerprint({
      sourceStream: "waia_runtime_route",
      alertType: "payment_watcher_offline",
      organizationId: null,
      outcome: "stale",
    }),
    observedAt: new Date().toISOString(),
    extensions: {},
  };
}

export function classifyAlertLine(line: string): AlertEnvelope | null {
  const record = tryParseJsonLine(line);
  if (record === null) {
    return null;
  }

  return (
    classifyTraderEvent(record) ??
    classifyPaymentWatcherEvent(record) ??
    classifyRuntimeRouteEvent(record)
  );
}

export function createDrillAlertEnvelope(): AlertEnvelope {
  const observedAt = new Date().toISOString();
  const alertType: AlertType = "paper_loop_critical";
  const organizationId = "00000000-0000-4000-8000-000000000001";
  const outcome = "cycle_complete";

  return {
    alertType,
    sourceStream: "waia_trader_event",
    organizationId,
    sourceKind: "paper_loop",
    outcome,
    fingerprint: buildAlertFingerprint({
      sourceStream: "waia_trader_event",
      alertType,
      organizationId,
      outcome,
    }),
    observedAt,
    extensions: {
      drill: true,
    },
  };
}
