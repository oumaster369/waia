import { NextResponse } from "next/server";

import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import {
  attachPostgresLifecycleToTelemetry,
  emitWaiaRuntimeRouteTelemetry,
  isWaiaConfigError,
  safeTelemetryErrorClass,
  type WaiaRuntimeRouteTelemetryPayload,
} from "@/lib/observability/waia-runtime-route-telemetry";
import { createPostgresReconciliationReader } from "@/lib/trader/settlement/reconciliation/reconciliation-reader-postgres";
import { createSqliteReconciliationReader } from "@/lib/trader/settlement/reconciliation/reconciliation-reader-sqlite";

export const dynamic = "force-dynamic";

const STALE_OPEN_THRESHOLD = 5;

/** GET /api/health/settlement-reconciliation — reconciliation backlog probe (AT-E12 S3-C-A). */
export async function GET() {
  let resolved: WaiaRuntimeDb | undefined;
  let telemetryPayload: WaiaRuntimeRouteTelemetryPayload | undefined;
  const telemetryStart = Date.now();

  try {
    const handle = await getWaiaRuntimeDb();
    resolved = handle;

    const reader =
      handle.kind === "sqlite"
        ? createSqliteReconciliationReader(handle.db)
        : createPostgresReconciliationReader(handle.db);

    const metrics = await reader.getHealthMetrics();
    const ok = metrics.orphanExceptionCount === 0 && metrics.staleCount < STALE_OPEN_THRESHOLD;

    telemetryPayload = {
      event: "waia_runtime_route",
      route: "health_settlement_reconciliation",
      waia_db_backend: handle.kind,
      http_status: ok ? 200 : 503,
      outcome: ok ? "success" : "stale",
      duration_ms: Date.now() - telemetryStart,
    };

    return NextResponse.json(
      {
        open_count: metrics.openCount,
        stale_count: metrics.staleCount,
        orphan_exception_count: metrics.orphanExceptionCount,
        open_age_p95_seconds: metrics.openAgeP95Seconds,
        ok,
      },
      { status: ok ? 200 : 503 },
    );
  } catch (err) {
    const outcome = !resolved && isWaiaConfigError(err) ? "config_error" : "internal_error";
    telemetryPayload = {
      event: "waia_runtime_route",
      route: "health_settlement_reconciliation",
      waia_db_backend: resolved?.kind,
      http_status: 500,
      outcome,
      duration_ms: Date.now() - telemetryStart,
      error_class: safeTelemetryErrorClass(err),
    };
    throw err;
  } finally {
    const pgClose = await disposeWaiaRuntimeDb(resolved);
    if (telemetryPayload) {
      attachPostgresLifecycleToTelemetry(telemetryPayload, resolved, pgClose);
      emitWaiaRuntimeRouteTelemetry(telemetryPayload);
    }
  }
}
