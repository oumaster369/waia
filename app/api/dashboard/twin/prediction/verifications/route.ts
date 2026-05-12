import { NextResponse } from "next/server";

import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import type { TwinPredictionVerificationListApiResponse } from "@/lib/dashboard/twin-prediction-verification-api.types";
import { TWIN_PREDICTION_VERIFICATION_SCHEMA_VERSION } from "@/lib/dashboard/twin-prediction-verification-api.types";
import {
  attachPostgresLifecycleToTelemetry,
  emitWaiaRuntimeRouteTelemetry,
  isWaiaConfigError,
  safeTelemetryErrorClass,
  type WaiaRuntimeRouteTelemetryPayload,
} from "@/lib/observability/waia-runtime-route-telemetry";
import { resolveTwinPersistence } from "@/lib/persistence/runtime";
import { listTwinPredictionVerificationsForUser } from "@/lib/twin-persistence/twin-prediction-verifications";

export const dynamic = "force-dynamic";

function unauthorizedEnvelope(): ApiErrorEnvelope {
  return { error: { code: "UNAUTHORIZED", message: "Session required." } };
}

function validationErrorEnvelope(code: string, message: string): ApiErrorEnvelope {
  return { error: { code, message } };
}

/** GET /api/dashboard/twin/prediction/verifications — latest verifications for session user (DEE-34). */
export async function GET(request: Request) {
  const userId = await getOptionalSessionUserId();
  if (!userId) {
    return NextResponse.json(unauthorizedEnvelope(), { status: 401 });
  }

  let limit: number | undefined;
  const { searchParams } = new URL(request.url);
  const rawLimit = searchParams.get("limit");
  if (rawLimit !== null && rawLimit !== "") {
    const n = Number(rawLimit);
    if (!Number.isFinite(n) || n < 1) {
      return NextResponse.json(
        validationErrorEnvelope("INVALID_QUERY", "limit must be a positive number when provided."),
        { status: 400 },
      );
    }
    limit = n;
  }

  let resolvedRuntime: WaiaRuntimeDb | undefined;
  let telemetryPayload: WaiaRuntimeRouteTelemetryPayload | undefined;
  const telemetryStart = Date.now();
  try {
    const runtime = await getWaiaRuntimeDb();
    resolvedRuntime = runtime;
    const verifications =
      runtime.kind === "sqlite"
        ? listTwinPredictionVerificationsForUser(runtime.db, userId, limit)
        : await resolveTwinPersistence(runtime).listTwinPredictionVerificationsForUser(userId, limit);

    const body: TwinPredictionVerificationListApiResponse = {
      schemaVersion: TWIN_PREDICTION_VERIFICATION_SCHEMA_VERSION,
      verifications,
    };

    telemetryPayload = {
      event: "waia_runtime_route",
      route: "prediction_verifications",
      waia_db_backend: runtime.kind,
      http_status: 200,
      outcome: "success",
      duration_ms: Date.now() - telemetryStart,
    };

    return NextResponse.json(body, {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    const outcome =
      !resolvedRuntime && isWaiaConfigError(err) ? "config_error" : "internal_error";
    telemetryPayload = {
      event: "waia_runtime_route",
      route: "prediction_verifications",
      waia_db_backend: resolvedRuntime?.kind,
      http_status: 500,
      outcome,
      duration_ms: Date.now() - telemetryStart,
      error_class: safeTelemetryErrorClass(err),
    };
    throw err;
  } finally {
    const pgClose = await disposeWaiaRuntimeDb(resolvedRuntime);
    if (telemetryPayload) {
      attachPostgresLifecycleToTelemetry(telemetryPayload, resolvedRuntime, pgClose);
      emitWaiaRuntimeRouteTelemetry(telemetryPayload);
    }
  }
}
