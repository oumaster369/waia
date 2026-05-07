import { describe, expect, it } from "vitest";

import {
  emitWaiaRuntimeRouteTelemetry,
  isWaiaConfigError,
  safeTelemetryErrorClass,
  type WaiaRuntimeRouteTelemetryPayload,
} from "@/lib/observability/waia-runtime-route-telemetry";

describe("waia-runtime-route-telemetry", () => {
  it("isWaiaConfigError matches [waia] Error messages only", () => {
    expect(isWaiaConfigError(new Error("[waia] WAIA_DB_BACKEND=postgres requires …"))).toBe(true);
    expect(isWaiaConfigError(new Error("connection refused"))).toBe(false);
    expect(isWaiaConfigError("string throw")).toBe(false);
    expect(isWaiaConfigError(null)).toBe(false);
  });

  it("safeTelemetryErrorClass returns Error.name only", () => {
    expect(safeTelemetryErrorClass(new TypeError("oops"))).toBe("TypeError");
    expect(safeTelemetryErrorClass("x")).toBeUndefined();
  });

  it("emitWaiaRuntimeRouteTelemetry uses sink with stable JSON shape", () => {
    const lines: string[] = [];
    const payload: WaiaRuntimeRouteTelemetryPayload = {
      event: "waia_runtime_route",
      route: "twin_engine",
      waia_db_backend: "sqlite",
      http_status: 200,
      outcome: "success",
      duration_ms: 12,
    };
    emitWaiaRuntimeRouteTelemetry(payload, (line) => {
      lines.push(line);
    });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as WaiaRuntimeRouteTelemetryPayload;
    expect(parsed).toMatchObject(payload);
    expect(parsed).not.toHaveProperty("message");
  });

  it("allows omitting waia_db_backend for pre-resolve failures", () => {
    const lines: string[] = [];
    emitWaiaRuntimeRouteTelemetry(
      {
        event: "waia_runtime_route",
        route: "health_database",
        http_status: 500,
        outcome: "config_error",
        duration_ms: 0,
        error_class: "Error",
      },
      (line) => lines.push(line),
    );
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.waia_db_backend).toBeUndefined();
    expect(parsed.error_class).toBe("Error");
  });
});
