import { NextResponse } from "next/server";

import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import {
  MAX_VERIFICATION_CORRECTION_CHARS,
  MAX_VERIFICATION_SCENARIO_CHARS,
  TWIN_PREDICTION_VERIFICATION_KINDS,
  TWIN_PREDICTION_VERIFICATION_SCHEMA_VERSION,
  type TwinPredictionVerificationAppendApiResponse,
  type TwinPredictionVerificationKind,
} from "@/lib/dashboard/twin-prediction-verification-api.types";
import {
  attachPostgresLifecycleToTelemetry,
  emitWaiaRuntimeRouteTelemetry,
  isWaiaConfigError,
  safeTelemetryErrorClass,
  type WaiaRuntimeRouteTelemetryPayload,
} from "@/lib/observability/waia-runtime-route-telemetry";
import { resolveTwinPersistence } from "@/lib/persistence/runtime";
import {
  appendTwinPredictionVerificationForUser,
  isTwinPredictionVerificationKind,
} from "@/lib/twin-persistence/twin-prediction-verifications";
import { recordRepeatabilityAfterVerification } from "@/lib/twin-persistence/twin-repeatability";

export const dynamic = "force-dynamic";

function unauthorizedEnvelope(): ApiErrorEnvelope {
  return { error: { code: "UNAUTHORIZED", message: "Session required." } };
}

function validationErrorEnvelope(code: string, message: string): ApiErrorEnvelope {
  return { error: { code, message } };
}

type PostBodyJson = {
  predictionId?: unknown;
  scenario?: unknown;
  verification?: unknown;
  correction?: unknown;
};

/** POST /api/dashboard/twin/prediction/verification — persist user verification (DEE-34). */
export async function POST(request: Request) {
  const userId = await getOptionalSessionUserId();
  if (!userId) {
    return NextResponse.json(unauthorizedEnvelope(), { status: 401 });
  }

  let parsed: PostBodyJson;
  try {
    parsed = (await request.json()) as PostBodyJson;
  } catch {
    return NextResponse.json(
      validationErrorEnvelope("INVALID_BODY", "Expected JSON body."),
      { status: 400 },
    );
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json(
      validationErrorEnvelope("INVALID_BODY", "Request body must be a JSON object."),
      { status: 400 },
    );
  }

  const rawScenario = parsed.scenario;
  if (typeof rawScenario !== "string") {
    return NextResponse.json(
      validationErrorEnvelope("INVALID_BODY", "scenario must be a string."),
      { status: 400 },
    );
  }
  const scenarioTrimmed = rawScenario.trim();
  if (scenarioTrimmed.length === 0) {
    return NextResponse.json(
      validationErrorEnvelope("EMPTY_SCENARIO", "scenario must not be empty or whitespace."),
      { status: 400 },
    );
  }
  if (scenarioTrimmed.length > MAX_VERIFICATION_SCENARIO_CHARS) {
    return NextResponse.json(
      validationErrorEnvelope(
        "SCENARIO_TOO_LONG",
        `scenario must not exceed ${MAX_VERIFICATION_SCENARIO_CHARS} characters.`,
      ),
      { status: 400 },
    );
  }

  const rawVerification = parsed.verification;
  if (typeof rawVerification !== "string" || !isTwinPredictionVerificationKind(rawVerification)) {
    return NextResponse.json(
      validationErrorEnvelope(
        "INVALID_VERIFICATION",
        `verification must be one of: ${TWIN_PREDICTION_VERIFICATION_KINDS.join(", ")}.`,
      ),
      { status: 400 },
    );
  }
  const verification: TwinPredictionVerificationKind = rawVerification;

  let predictionId: string | null | undefined;
  const rawPredictionId = parsed.predictionId;
  if (rawPredictionId !== undefined && rawPredictionId !== null) {
    if (typeof rawPredictionId !== "string") {
      return NextResponse.json(
        validationErrorEnvelope("INVALID_BODY", "predictionId must be a string when provided."),
        { status: 400 },
      );
    }
    predictionId = rawPredictionId;
  }

  let correction: string | null | undefined;
  const rawCorrection = parsed.correction;
  if (rawCorrection !== undefined && rawCorrection !== null) {
    if (typeof rawCorrection !== "string") {
      return NextResponse.json(
        validationErrorEnvelope("INVALID_BODY", "correction must be a string when provided."),
        { status: 400 },
      );
    }
    const cTrim = rawCorrection.trim();
    if (cTrim.length > MAX_VERIFICATION_CORRECTION_CHARS) {
      return NextResponse.json(
        validationErrorEnvelope(
          "CORRECTION_TOO_LONG",
          `correction must not exceed ${MAX_VERIFICATION_CORRECTION_CHARS} characters.`,
        ),
        { status: 400 },
      );
    }
    correction = rawCorrection;
  }

  let resolvedRuntime: WaiaRuntimeDb | undefined;
  let telemetryPayload: WaiaRuntimeRouteTelemetryPayload | undefined;
  const telemetryStart = Date.now();
  try {
    const runtime = await getWaiaRuntimeDb();
    resolvedRuntime = runtime;

    let dto;
    if (runtime.kind === "sqlite") {
      dto = appendTwinPredictionVerificationForUser(runtime.db, userId, {
        predictionId,
        scenario: scenarioTrimmed,
        verification,
        correction,
      });
      recordRepeatabilityAfterVerification(runtime.db, userId, {
        scenarioTrimmed,
        verification,
      });
    } else {
      const p = resolveTwinPersistence(runtime);
      dto = await p.appendTwinPredictionVerificationForUser({
        userId,
        scenario: scenarioTrimmed,
        verification,
        predictionId,
        correction,
      });
      try {
        await p.appendRepeatabilityRecordForUser({
          userId,
          scenarioTrimmed,
          verificationResult: verification,
        });
      } catch {
        /* best-effort: verification row already persisted */
      }
    }

    const body: TwinPredictionVerificationAppendApiResponse = {
      schemaVersion: TWIN_PREDICTION_VERIFICATION_SCHEMA_VERSION,
      verification: dto,
    };

    telemetryPayload = {
      event: "waia_runtime_route",
      route: "prediction_verification",
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
      route: "prediction_verification",
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
