import { NextResponse } from "next/server";

import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { createPostgresConfirmedPaymentsReader } from "@/lib/trader/settlement/confirmed-payments-reader-postgres";
import { createSqliteConfirmedPaymentsReader } from "@/lib/trader/settlement/confirmed-payments-reader-sqlite";
import {
  attachPostgresLifecycleToTelemetry,
  emitWaiaRuntimeRouteTelemetry,
  isWaiaConfigError,
  safeTelemetryErrorClass,
  type WaiaRuntimeRouteTelemetryPayload,
} from "@/lib/observability/waia-runtime-route-telemetry";

export const dynamic = "force-dynamic";

const STALE_BACKLOG_THRESHOLD = 10;

/** GET /api/health/settlement — settlement backlog + exception probe (AT-E12 S3-B). */
export async function GET() {
  let resolved: WaiaRuntimeDb | undefined;
  let telemetryPayload: WaiaRuntimeRouteTelemetryPayload | undefined;
  const telemetryStart = Date.now();

  try {
    const handle = await getWaiaRuntimeDb();
    resolved = handle;

    const reader =
      handle.kind === "sqlite"
        ? createSqliteConfirmedPaymentsReader(handle.db)
        : createPostgresConfirmedPaymentsReader(handle.db);

    const [backlog, exceptionCount] = await Promise.all([
      reader.countUnsettledConfirmedTraderPayments(),
      reader.countExceptionSettlements(),
    ]);

    const ok = backlog < STALE_BACKLOG_THRESHOLD;

    telemetryPayload = {
      event: "waia_runtime_route",
      route: "health_settlement",
      waia_db_backend: handle.kind,
      http_status: ok ? 200 : 503,
      outcome: ok ? "success" : "stale",
      duration_ms: Date.now() - telemetryStart,
    };

    return NextResponse.json(
      {
        backlog,
        exception_count: exceptionCount,
        ok,
      },
      { status: ok ? 200 : 503 },
    );
  } catch (err) {
    const outcome = !resolved && isWaiaConfigError(err) ? "config_error" : "internal_error";
    telemetryPayload = {
      event: "waia_runtime_route",
      route: "health_settlement",
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
