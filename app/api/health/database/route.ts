import { sql } from "drizzle-orm";
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

export const dynamic = "force-dynamic";

/** GET /api/health/database — connectivity probe only (DEE-64B2 Slice C1). */
export async function GET() {
  let resolved: WaiaRuntimeDb | undefined;
  let telemetryPayload: WaiaRuntimeRouteTelemetryPayload | undefined;
  const telemetryStart = Date.now();
  try {
    const handle = await getWaiaRuntimeDb();
    resolved = handle;
    if (handle.kind === "sqlite") {
      telemetryPayload = {
        event: "waia_runtime_route",
        route: "health_database",
        waia_db_backend: "sqlite",
        http_status: 200,
        outcome: "success",
        duration_ms: Date.now() - telemetryStart,
      };
      return NextResponse.json({ backend: "sqlite", ok: true });
    }
    await handle.db.execute(sql`select 1`);
    telemetryPayload = {
      event: "waia_runtime_route",
      route: "health_database",
      waia_db_backend: "postgres",
      http_status: 200,
      outcome: "success",
      duration_ms: Date.now() - telemetryStart,
    };
    return NextResponse.json({ backend: "postgres", ok: true });
  } catch (err) {
    const outcome = !resolved && isWaiaConfigError(err) ? "config_error" : "internal_error";
    telemetryPayload = {
      event: "waia_runtime_route",
      route: "health_database",
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
