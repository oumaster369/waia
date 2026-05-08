import "server-only";

/**
 * Structured stdout telemetry for `getWaiaRuntimeDb`-aware API routes (DEE-95f).
 *
 * @see docs/migrations/DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md — field meanings, triage, limitations.
 */
/** Stable route keys for `getWaiaRuntimeDb`-aware handlers (DEE-95f). */
export type WaiaRuntimeRouteKey =
  | "twin_engine"
  | "twin_dialogue_turn"
  | "twin_dialogue_turns"
  | "dashboard_readiness"
  | "diary_entries"
  | "prediction_verification"
  | "prediction_verifications"
  | "repeatability"
  | "health_database";

export type WaiaRuntimeRouteOutcome =
  | "success"
  | "client_error"
  | "config_error"
  | "internal_error";

export type WaiaRuntimeRouteTelemetryPayload = {
  event: "waia_runtime_route";
  route: WaiaRuntimeRouteKey;
  /** Present only after `getWaiaRuntimeDb` resolved successfully. */
  waia_db_backend?: "sqlite" | "postgres";
  http_status: number;
  outcome: WaiaRuntimeRouteOutcome;
  duration_ms: number;
  /** `Error.prototype.name` only — never log message text (privacy / PII). */
  error_class?: string;
};

export type WaiaRuntimeRouteTelemetrySink = (line: string) => void;

const defaultSink: WaiaRuntimeRouteTelemetrySink = (line) => {
  console.info(line);
};

export function emitWaiaRuntimeRouteTelemetry(
  payload: WaiaRuntimeRouteTelemetryPayload,
  sink: WaiaRuntimeRouteTelemetrySink = defaultSink,
): void {
  sink(JSON.stringify(payload));
}

/** Matches misconfiguration throws from {@link getResolvedWaiaDbRuntimeConfig} and similar. */
export function isWaiaConfigError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("[waia]");
}

export function safeTelemetryErrorClass(err: unknown): string | undefined {
  if (err instanceof Error) {
    return err.name;
  }
  return undefined;
}
