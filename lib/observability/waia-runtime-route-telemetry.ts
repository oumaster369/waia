import "server-only";

/**
 * Structured stdout telemetry for `getWaiaRuntimeDb`-aware API routes (DEE-95f).
 *
 * @see docs/migrations/DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md — field meanings, triage, limitations.
 */
/** Stable route keys for `getWaiaRuntimeDb`-aware handlers (DEE-95f). */
export type WaiaRuntimeRouteKey =
  | "twin_engine"
  | "twin_prediction"
  | "twin_pattern_summary"
  | "twin_contradictions"
  | "twin_dialogue_turn"
  | "twin_dialogue_turns"
  | "dashboard_readiness"
  | "diary_entries"
  | "diary_scenario_answers"
  | "prediction_verification"
  | "prediction_verifications"
  | "repeatability"
  | "health_database";

export type WaiaRuntimeRouteOutcome =
  | "success"
  | "client_error"
  | "config_error"
  | "internal_error";

/** Twin dialogue gateway provider outcome — content-free (DEE-78). */
export type WaiaAiGatewayProviderOutcomeTelemetry =
  | "ok"
  | "rate_limit"
  | "timeout"
  | "provider_error"
  | "config"
  | "degraded";

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
  /**
   * Twin dialogue AI Gateway foundation path (DEE-77 / DEE-78). Content-free; no user text.
   * `live` — foundation enabled and OpenAI-compatible adapter returned assistant text.
   * Omitted on routes other than `twin_dialogue_turn` unless extended intentionally.
   */
  ai_gateway_foundation?: "off" | "fake_stub" | "live";
  /** Which completion backend handled the request when foundation path is active (DEE-78). */
  ai_gateway_provider?: "fake" | "openai-compatible";
  /** Provider-phase classification — never includes raw messages or user text (DEE-78). */
  ai_gateway_provider_outcome?: WaiaAiGatewayProviderOutcomeTelemetry;
  /** Wall time for provider-phase completion call when foundation path runs a provider. */
  ai_gateway_provider_phase_ms?: number;
  /** True when fake provider failed and assistant text fell back to product stub. */
  ai_gateway_degraded?: boolean;
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
