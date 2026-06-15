import { describe, expect, it } from "vitest";

import {
  emitTraderTelemetry,
  FORBIDDEN_TRADER_TELEMETRY_KEYS,
  incrementTraderCounter,
  safeTraderTelemetryErrorClass,
  type WaiaTraderTelemetryPayload,
} from "@/lib/observability/waia-trader-telemetry";

const ORG_ID = "00000000-0000-4000-8000-000000000001";

describe("waia-trader-telemetry", () => {
  it("safeTraderTelemetryErrorClass returns Error.name only", () => {
    expect(safeTraderTelemetryErrorClass(new TypeError("secret detail"))).toBe("TypeError");
    expect(safeTraderTelemetryErrorClass("x")).toBeUndefined();
  });

  it("emitTraderTelemetry uses sink with stable JSON shape", () => {
    const lines: string[] = [];
    const payload: WaiaTraderTelemetryPayload = {
      event: "waia_trader_event",
      kind: "execution",
      organization_id: ORG_ID,
      outcome: "submitted",
      severity: "info",
      duration_ms: 12,
    };
    emitTraderTelemetry(payload, (line) => {
      lines.push(line);
    });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as WaiaTraderTelemetryPayload;
    expect(parsed).toMatchObject(payload);
    expect(parsed).not.toHaveProperty("message");
  });

  it("omits undefined optional fields from JSON output", () => {
    const lines: string[] = [];
    emitTraderTelemetry(
      {
        event: "waia_trader_event",
        kind: "reconciliation",
        organization_id: ORG_ID,
        outcome: "run_complete",
        severity: "info",
      },
      (line) => lines.push(line),
    );
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.duration_ms).toBeUndefined();
    expect(parsed.error_class).toBeUndefined();
  });

  it("incrementTraderCounter emits counter increment with default delta", () => {
    const lines: string[] = [];
    incrementTraderCounter(
      {
        organization_id: ORG_ID,
        domain: "risk",
        code: "RISK_MAX_DAILY_LOSS",
      },
      (line) => lines.push(line),
    );
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.event).toBe("waia_trader_event");
    expect(parsed.kind).toBe("counter");
    expect(parsed.outcome).toBe("increment");
    expect(parsed.domain).toBe("risk");
    expect(parsed.code).toBe("RISK_MAX_DAILY_LOSS");
    expect(parsed.delta).toBe(1);
    expect(parsed.severity).toBe("info");
  });

  it("incrementTraderCounter rejects non-finite delta", () => {
    expect(() =>
      incrementTraderCounter({
        organization_id: ORG_ID,
        domain: "risk",
        code: "RISK_EVALUATION_ERROR",
        delta: Number.NaN,
      }),
    ).toThrow(/finite number/);
  });

  it("rejects forbidden telemetry keys before sink", () => {
    for (const key of FORBIDDEN_TRADER_TELEMETRY_KEYS) {
      expect(() =>
        emitTraderTelemetry({
          event: "waia_trader_event",
          kind: "execution",
          organization_id: ORG_ID,
          outcome: "submitted",
          severity: "info",
          [key]: "leak",
        }),
      ).toThrow(/forbidden telemetry key/);
    }
  });

  it("rejects non-scalar extension values", () => {
    expect(() =>
      emitTraderTelemetry({
        event: "waia_trader_event",
        kind: "execution",
        organization_id: ORG_ID,
        outcome: "submitted",
        severity: "info",
        nested: { bad: true } as unknown as string,
      }),
    ).toThrow(/non-scalar extension/);
  });

  it("rejects invalid duration_ms", () => {
    expect(() =>
      emitTraderTelemetry({
        event: "waia_trader_event",
        kind: "execution",
        organization_id: ORG_ID,
        outcome: "submitted",
        severity: "info",
        duration_ms: -1,
      }),
    ).toThrow(/duration_ms/);
  });

  it("allows client_order_id_suffix extension for downstream slices", () => {
    const lines: string[] = [];
    emitTraderTelemetry(
      {
        event: "waia_trader_event",
        kind: "execution",
        organization_id: ORG_ID,
        outcome: "submitted",
        severity: "info",
        client_order_id_suffix: "abcd",
      },
      (line) => lines.push(line),
    );
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.client_order_id_suffix).toBe("abcd");
  });
});
