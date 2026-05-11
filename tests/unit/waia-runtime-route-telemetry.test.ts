import { describe, expect, it } from "vitest";

import {
  emitWaiaRuntimeRouteTelemetry,
  isWaiaConfigError,
  safeTelemetryErrorClass,
  type WaiaRuntimeRouteTelemetryPayload,
  type WaiaAiGatewayProviderOutcomeTelemetry,
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

  it("accepts twin_dialogue_turn gateway extensions without message bodies", () => {
    const lines: string[] = [];
    const outcome: WaiaAiGatewayProviderOutcomeTelemetry = "ok";
    const payload: WaiaRuntimeRouteTelemetryPayload = {
      event: "waia_runtime_route",
      route: "twin_dialogue_turn",
      waia_db_backend: "sqlite",
      http_status: 200,
      outcome: "success",
      duration_ms: 40,
      ai_gateway_foundation: "live",
      ai_gateway_provider: "openai-compatible",
      ai_gateway_provider_outcome: outcome,
      ai_gateway_provider_phase_ms: 38,
      ai_gateway_provider_prompt_tokens: 1,
      ai_gateway_provider_completion_tokens: 2,
      ai_gateway_provider_total_tokens: 3,
      ai_gateway_provider_request_id: "chatcmpl-test",
    };
    emitWaiaRuntimeRouteTelemetry(payload, (line) => lines.push(line));
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.ai_gateway_foundation).toBe("live");
    expect(parsed.ai_gateway_provider).toBe("openai-compatible");
    expect(parsed.ai_gateway_provider_outcome).toBe("ok");
    expect(parsed.ai_gateway_provider_phase_ms).toBe(38);
    expect(parsed.ai_gateway_provider_prompt_tokens).toBe(1);
    expect(parsed.ai_gateway_provider_completion_tokens).toBe(2);
    expect(parsed.ai_gateway_provider_total_tokens).toBe(3);
    expect(parsed.ai_gateway_provider_request_id).toBe("chatcmpl-test");
    expect(parsed).not.toHaveProperty("message");
  });
});
