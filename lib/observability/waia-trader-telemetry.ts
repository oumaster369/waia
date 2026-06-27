import "server-only";

/**
 * Structured stdout telemetry for trader service-layer events (DEE-253 / AT-E15 S1).
 *
 * Separate from {@link emitWaiaRuntimeRouteTelemetry} / ADR-0003 route attribution.
 *
 * @see docs/migrations/DEE-222-TRADER-TELEMETRY-SCHEMA.md — field meanings and grep examples.
 * @see docs/migrations/DEE-95G-RUNTIME-TELEMETRY-RUNBOOK.md — where stdout logs appear.
 */
export type WaiaTraderEventKind = "execution" | "reconciliation" | "counter" | "paper_loop";

export type WaiaTraderTelemetrySeverity = "info" | "critical";

/** Base envelope — all emitted trader events MUST satisfy this. */
export type WaiaTraderTelemetryBase = {
  event: "waia_trader_event";
  kind: WaiaTraderEventKind;
  organization_id: string;
  outcome: string;
  severity: WaiaTraderTelemetrySeverity;
  duration_ms?: number;
  /** `Error.prototype.name` only — never log message text. */
  error_class?: string;
};

export type TraderTelemetryScalar = string | number | boolean | null;

/** Extensible payload for downstream slices — additional keys must pass forbidden-key scan. */
export type WaiaTraderTelemetryPayload = WaiaTraderTelemetryBase &
  Record<string, TraderTelemetryScalar | undefined>;

export type WaiaTraderCounterInput = {
  organization_id: string;
  domain: string;
  code: string;
  delta?: number;
  severity?: WaiaTraderTelemetrySeverity;
};

export type WaiaTraderTelemetrySink = (line: string) => void;

/** Case-sensitive keys that must never appear on trader telemetry payloads. */
export const FORBIDDEN_TRADER_TELEMETRY_KEYS = [
  "message",
  "stack",
  "apiKey",
  "api_key",
  "secret",
  "password",
  "token",
  "credential",
  "authorization",
  "quantity",
  "price",
  "client_order_id",
  "idempotency_key",
  "strategy_signal_id",
  "exchange_order_id",
] as const;

const forbiddenKeySet = new Set<string>(FORBIDDEN_TRADER_TELEMETRY_KEYS);

const defaultSink: WaiaTraderTelemetrySink = (line) => {
  console.info(line);
};

export function safeTraderTelemetryErrorClass(err: unknown): string | undefined {
  if (err instanceof Error) {
    return err.name;
  }
  return undefined;
}

function assertScalarExtensionValue(key: string, value: unknown): void {
  if (value === undefined) {
    return;
  }
  const valueType = typeof value;
  if (
    value === null ||
    valueType === "string" ||
    valueType === "number" ||
    valueType === "boolean"
  ) {
    return;
  }
  throw new Error(`[waia_trader_event] non-scalar extension "${key}"`);
}

function assertTraderTelemetryPayload(
  payload: WaiaTraderTelemetryPayload,
): WaiaTraderTelemetryPayload {
  if (payload.event !== "waia_trader_event") {
    throw new Error('[waia_trader_event] payload.event must be "waia_trader_event"');
  }

  const baseKeys = new Set([
    "event",
    "kind",
    "organization_id",
    "outcome",
    "severity",
    "duration_ms",
    "error_class",
  ]);

  for (const key of Object.keys(payload)) {
    if (forbiddenKeySet.has(key)) {
      throw new Error(`[waia_trader_event] forbidden telemetry key "${key}"`);
    }
    if (!baseKeys.has(key)) {
      assertScalarExtensionValue(key, payload[key]);
    }
  }

  if (payload.duration_ms !== undefined) {
    if (!Number.isFinite(payload.duration_ms) || payload.duration_ms < 0) {
      throw new Error("[waia_trader_event] duration_ms must be a non-negative finite number");
    }
  }

  return payload;
}

export function emitTraderTelemetry(
  payload: WaiaTraderTelemetryPayload,
  sink: WaiaTraderTelemetrySink = defaultSink,
): void {
  const sanitized = assertTraderTelemetryPayload(payload);
  sink(JSON.stringify(sanitized));
}

export function incrementTraderCounter(
  input: WaiaTraderCounterInput,
  sink: WaiaTraderTelemetrySink = defaultSink,
): void {
  const delta = input.delta ?? 1;
  if (!Number.isFinite(delta)) {
    throw new Error("[waia_trader_event] counter delta must be a finite number");
  }

  emitTraderTelemetry(
    {
      event: "waia_trader_event",
      kind: "counter",
      organization_id: input.organization_id,
      outcome: "increment",
      severity: input.severity ?? "info",
      domain: input.domain,
      code: input.code,
      delta,
    },
    sink,
  );
}
