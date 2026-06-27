import { NextResponse } from "next/server";

import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { createPostgresWatcherCheckpointRepositoryAdapter } from "@/lib/waia-core/payment-watcher/checkpoint-repository-adapters";
import { createSqliteWatcherCheckpointRepositoryAdapter } from "@/lib/waia-core/payment-watcher/checkpoint-repository-adapters";
import {
  CANONICAL_NETWORK,
  loadWatcherConfig,
} from "@/lib/waia-core/payment-watcher/watcher-config";
import {
  attachPostgresLifecycleToTelemetry,
  emitWaiaRuntimeRouteTelemetry,
  isWaiaConfigError,
  safeTelemetryErrorClass,
  type WaiaRuntimeRouteTelemetryPayload,
} from "@/lib/observability/waia-runtime-route-telemetry";

export const dynamic = "force-dynamic";

/** GET /api/health/payment-watcher — watcher checkpoint lag probe (DEE-321). */
export async function GET() {
  let resolved: WaiaRuntimeDb | undefined;
  let telemetryPayload: WaiaRuntimeRouteTelemetryPayload | undefined;
  const telemetryStart = Date.now();
  const config = loadWatcherConfig();

  try {
    const handle = await getWaiaRuntimeDb();
    resolved = handle;

    const checkpoint =
      handle.kind === "sqlite"
        ? await createSqliteWatcherCheckpointRepositoryAdapter(handle.db).load(CANONICAL_NETWORK)
        : await createPostgresWatcherCheckpointRepositoryAdapter(handle.db).load(CANONICAL_NETWORK);

    const now = Date.now();
    const lastScannedAt = checkpoint?.lastScannedAt?.toISOString() ?? null;
    const scanLagSeconds = checkpoint
      ? Math.max(0, Math.floor((now - checkpoint.lastScannedAt.getTime()) / 1000))
      : null;
    const ok = scanLagSeconds !== null && scanLagSeconds < config.staleThresholdSeconds;

    telemetryPayload = {
      event: "waia_runtime_route",
      route: "health_payment_watcher",
      waia_db_backend: handle.kind,
      http_status: ok ? 200 : 503,
      outcome: ok ? "success" : "stale",
      duration_ms: Date.now() - telemetryStart,
    };

    return NextResponse.json(
      {
        network: CANONICAL_NETWORK,
        last_scanned_at: lastScannedAt,
        scan_lag_seconds: scanLagSeconds,
        last_error: checkpoint?.lastError ?? null,
        last_error_at: checkpoint?.lastErrorAt?.toISOString() ?? null,
        ok,
      },
      { status: ok ? 200 : 503 },
    );
  } catch (err) {
    const outcome = !resolved && isWaiaConfigError(err) ? "config_error" : "internal_error";
    telemetryPayload = {
      event: "waia_runtime_route",
      route: "health_payment_watcher",
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
