import { NextResponse } from "next/server";

import {
  emitWaiaRuntimeRouteTelemetry,
  type WaiaRuntimeRouteKey,
  type WaiaRuntimeRouteTelemetryPayload,
} from "@/lib/observability/waia-runtime-route-telemetry";
import {
  createProductionSettlementReconciliationHandlerDeps,
  handleSettlementReconciliationCaseDetail,
  type SettlementReconciliationHandlerResult,
} from "@/lib/trader/settlement/reconciliation/settlement-reconciliation-handler";

export const dynamic = "force-dynamic";

function jsonFromHandlerResult(result: SettlementReconciliationHandlerResult): NextResponse {
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

/** GET /api/trader/settlement-reconciliation/cases/[caseId] — case detail (AT-E12 S3-C-A). */
export async function GET(_request: Request, context: { params: Promise<{ caseId: string }> }) {
  const telemetryStart = Date.now();
  const { caseId } = await context.params;

  try {
    const result = await handleSettlementReconciliationCaseDetail(
      caseId,
      createProductionSettlementReconciliationHandlerDeps(),
    );

    const telemetryPayload: WaiaRuntimeRouteTelemetryPayload = {
      event: "waia_runtime_route",
      route: "trader_settlement_reconciliation_case_detail" satisfies WaiaRuntimeRouteKey,
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
      route: "trader_settlement_reconciliation_case_detail",
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
