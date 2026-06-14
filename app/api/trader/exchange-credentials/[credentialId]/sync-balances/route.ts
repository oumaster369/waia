import { NextResponse } from "next/server";

import {
  emitWaiaRuntimeRouteTelemetry,
  type WaiaRuntimeRouteKey,
  type WaiaRuntimeRouteTelemetryPayload,
} from "@/lib/observability/waia-runtime-route-telemetry";
import {
  createProductionBalanceSyncDeps,
  handleBalanceSyncPost,
  type BalanceSyncHandlerResult,
} from "@/lib/trader/balances/sync-handler";

export const dynamic = "force-dynamic";

function jsonFromHandlerResult(result: BalanceSyncHandlerResult): NextResponse {
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

/** POST /api/trader/exchange-credentials/[credentialId]/sync-balances — HTX balance sync (DEE-237). */
export async function POST(
  _request: Request,
  context: { params: Promise<{ credentialId: string }> },
) {
  const telemetryStart = Date.now();
  const { credentialId } = await context.params;

  try {
    const result = await handleBalanceSyncPost(credentialId, createProductionBalanceSyncDeps());

    const telemetryPayload: WaiaRuntimeRouteTelemetryPayload = {
      event: "waia_runtime_route",
      route: "trader_exchange_credentials_sync_balances" satisfies WaiaRuntimeRouteKey,
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
      route: "trader_exchange_credentials_sync_balances",
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
