import { NextResponse } from "next/server";

import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { MAX_SCENARIO_CHARS } from "@/lib/dashboard/twin-contradiction-detector-api.types";
import type { TwinContradictionDetectorApiResponse } from "@/lib/dashboard/twin-contradiction-detector-api.types";
import {
  emitWaiaRuntimeRouteTelemetry,
  isWaiaConfigError,
  safeTelemetryErrorClass,
} from "@/lib/observability/waia-runtime-route-telemetry";
import { resolveTwinPersistence } from "@/lib/persistence/runtime";
import {
  runTwinContradictionDetectorForUser,
  runTwinContradictionDetectorForUserAsync,
} from "@/lib/reasoning/twin-contradiction-detector";
import {
  createTwinMemorySearchPortPostgres,
  createTwinVerificationListPortPostgres,
} from "@/lib/reasoning/twin-reasoning-ports";

export const dynamic = "force-dynamic";

type SubmitBodyJson = {
  scenario?: unknown;
};

function validationErrorEnvelope(code: string, message: string): ApiErrorEnvelope {
  return { error: { code, message } };
}

/** POST /api/dashboard/twin/contradictions — Twin contradiction detector (DEE-30). */
export async function POST(request: Request) {
  const userId = await getOptionalSessionUserId();
  if (!userId) {
    return NextResponse.json(validationErrorEnvelope("UNAUTHORIZED", "Session required."), {
      status: 401,
    });
  }

  let parsed: SubmitBodyJson;
  try {
    parsed = (await request.json()) as SubmitBodyJson;
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

  let scenarioForDetector: string | undefined;
  if ("scenario" in parsed) {
    const raw = parsed.scenario;
    if (raw === null || raw === undefined) {
      scenarioForDetector = undefined;
    } else if (typeof raw !== "string") {
      return NextResponse.json(
        validationErrorEnvelope(
          "INVALID_BODY",
          "scenario must be a string, null, or omitted.",
        ),
        { status: 400 },
      );
    } else {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        scenarioForDetector = undefined;
      } else {
        if (trimmed.length > MAX_SCENARIO_CHARS) {
          return NextResponse.json(
            validationErrorEnvelope(
              "SCENARIO_TOO_LONG",
              `scenario must not exceed ${MAX_SCENARIO_CHARS} characters.`,
            ),
            { status: 400 },
          );
        }
        scenarioForDetector = trimmed;
      }
    }
  }

  const detectorOpts = scenarioForDetector
    ? { scenarioForRulesAndRetrieval: scenarioForDetector }
    : {};

  let resolvedRuntime: WaiaRuntimeDb | undefined;
  const telemetryStart = Date.now();
  try {
    const runtime = await getWaiaRuntimeDb();
    resolvedRuntime = runtime;

    let body: TwinContradictionDetectorApiResponse;
    if (runtime.kind === "sqlite") {
      body = runTwinContradictionDetectorForUser(runtime.db, userId, detectorOpts);
    } else {
      const p = resolveTwinPersistence(runtime);
      const memoryPort = createTwinMemorySearchPortPostgres(p);
      const verificationPort = createTwinVerificationListPortPostgres(p);
      body = await runTwinContradictionDetectorForUserAsync(
        memoryPort,
        verificationPort,
        userId,
        detectorOpts,
      );
    }

    emitWaiaRuntimeRouteTelemetry({
      event: "waia_runtime_route",
      route: "twin_contradictions",
      waia_db_backend: runtime.kind,
      http_status: 200,
      outcome: "success",
      duration_ms: Date.now() - telemetryStart,
    });

    return NextResponse.json(body, {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    const outcome =
      !resolvedRuntime && isWaiaConfigError(err) ? "config_error" : "internal_error";
    emitWaiaRuntimeRouteTelemetry({
      event: "waia_runtime_route",
      route: "twin_contradictions",
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
