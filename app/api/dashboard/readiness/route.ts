import { NextResponse } from "next/server";

import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { DashboardReadinessApiResponse } from "@/lib/dashboard/dashboard-readiness-api.types";
import { loadDashboardReadinessPayloadFromRuntime } from "@/lib/dashboard/dashboard-readiness-source";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import { computeReadinessResult } from "@/lib/readiness/readiness";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import {
  emitWaiaRuntimeRouteTelemetry,
  isWaiaConfigError,
  safeTelemetryErrorClass,
} from "@/lib/observability/waia-runtime-route-telemetry";

export const dynamic = "force-dynamic";

function unauthorizedEnvelope(): ApiErrorEnvelope {
  return { error: { code: "UNAUTHORIZED", message: "Session required." } };
}

function validationErrorEnvelope(code: string, message: string): ApiErrorEnvelope {
  return { error: { code, message } };
}

/**
 * Backend readiness envelope for dashboard clients.
 * Stable fields: readinessInput + readinessResult (+ hintsByIndicator stubs until DEE-17).
 */
export async function GET() {
  const userId = await getOptionalSessionUserId();
  if (!userId) {
    return NextResponse.json(unauthorizedEnvelope(), { status: 401 });
  }

  let resolvedRuntime: WaiaRuntimeDb | undefined;
  const telemetryStart = Date.now();
  try {
    const runtime = await getWaiaRuntimeDb();
    resolvedRuntime = runtime;
    const payload = await loadDashboardReadinessPayloadFromRuntime(runtime, userId);
    const readinessResult = computeReadinessResult(payload.readinessInput);
    const body: DashboardReadinessApiResponse = {
      ...payload,
      readinessResult,
    };

    emitWaiaRuntimeRouteTelemetry({
      event: "waia_runtime_route",
      route: "dashboard_readiness",
      waia_db_backend: runtime.kind,
      http_status: 200,
      outcome: "success",
      duration_ms: Date.now() - telemetryStart,
    });

    return NextResponse.json(body, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    const outcome =
      !resolvedRuntime && isWaiaConfigError(err) ? "config_error" : "internal_error";
    emitWaiaRuntimeRouteTelemetry({
      event: "waia_runtime_route",
      route: "dashboard_readiness",
      waia_db_backend: resolvedRuntime?.kind,
      http_status: 500,
      outcome,
      duration_ms: Date.now() - telemetryStart,
      error_class: safeTelemetryErrorClass(err),
    });
    return NextResponse.json(
      validationErrorEnvelope("INTERNAL_ERROR", "Something went wrong."),
      { status: 500 },
    );
  }
}
