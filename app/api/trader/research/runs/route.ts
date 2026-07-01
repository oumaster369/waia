import { NextResponse } from "next/server";

import {
  emitWaiaRuntimeRouteTelemetry,
  type WaiaRuntimeRouteKey,
  type WaiaRuntimeRouteTelemetryPayload,
} from "@/lib/observability/waia-runtime-route-telemetry";
import {
  createProductionResearchRunsDeps,
  handleResearchRunsGet,
  type ResearchRunsHandlerResult,
} from "@/lib/trader/research/research-runs-handler";

export const dynamic = "force-dynamic";

function jsonFromHandlerResult(result: ResearchRunsHandlerResult): NextResponse {
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

/** GET /api/trader/research/runs — read-only backtest run list (Postgres when available). */
export async function GET(request: Request) {
  const telemetryStart = Date.now();

  try {
    const result = await handleResearchRunsGet(request, createProductionResearchRunsDeps());

    const telemetryPayload: WaiaRuntimeRouteTelemetryPayload = {
      event: "waia_runtime_route",
      route: "trader_research_runs_list" satisfies WaiaRuntimeRouteKey,
      waia_db_backend: result.waiaDbBackend,
      http_status: result.status,
      outcome: result.outcome,
      duration_ms: Date.now() - telemetryStart,
      error_class: result.errorClass,
    };
    emitWaiaRuntimeRouteTelemetry(telemetryPayload);

    return jsonFromHandlerResult(result);
  } catch (err) {
    emitWaiaRuntimeRouteTelemetry({
      event: "waia_runtime_route",
      route: "trader_research_runs_list",
      http_status: 500,
      outcome: "internal_error",
      duration_ms: Date.now() - telemetryStart,
      error_class: err instanceof Error ? err.name : undefined,
    });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Something went wrong." } },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
