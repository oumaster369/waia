import { NextResponse } from "next/server";

import {
  emitWaiaRuntimeRouteTelemetry,
  isWaiaConfigError,
  safeTelemetryErrorClass,
  type WaiaRuntimeRouteKey,
} from "@/lib/observability/waia-runtime-route-telemetry";
import { adminErrorEnvelope, type AdminRouteHandlerResult } from "@/lib/trader/admin-route-shared";

export function jsonFromAdminResult(result: AdminRouteHandlerResult): NextResponse {
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  if (result.responseHeaders) {
    for (const [key, value] of Object.entries(result.responseHeaders)) {
      headers.set(key, value);
    }
  }
  return NextResponse.json(result.body, {
    status: result.status,
    headers,
  });
}

export async function runAdminRoute(
  route: WaiaRuntimeRouteKey,
  handler: () => Promise<AdminRouteHandlerResult>,
): Promise<NextResponse> {
  const telemetryStart = Date.now();

  try {
    const result = await handler();
    emitWaiaRuntimeRouteTelemetry({
      event: "waia_runtime_route",
      route,
      waia_db_backend: result.waiaDbBackend,
      http_status: result.status,
      outcome: result.outcome,
      duration_ms: Date.now() - telemetryStart,
      error_class: result.errorClass,
    });
    return jsonFromAdminResult(result);
  } catch (err) {
    const outcome = isWaiaConfigError(err) ? "config_error" : "internal_error";
    emitWaiaRuntimeRouteTelemetry({
      event: "waia_runtime_route",
      route,
      http_status: 500,
      outcome,
      duration_ms: Date.now() - telemetryStart,
      error_class: safeTelemetryErrorClass(err),
    });
    return NextResponse.json(adminErrorEnvelope("INTERNAL_ERROR", "Something went wrong."), {
      status: 500,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
