import { NextResponse } from "next/server";

import { getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { MAX_SCENARIO_CHARS } from "@/lib/dashboard/twin-contradiction-detector-api.types";
import { TwinEngineScenarioTooLongError } from "@/lib/reasoning/twin-engine";
import { runTwinEngineForRuntimeAsync } from "@/lib/reasoning/twin-engine-runtime";

export const dynamic = "force-dynamic";

function unauthorizedEnvelope(): ApiErrorEnvelope {
  return { error: { code: "UNAUTHORIZED", message: "Session required." } };
}

function validationErrorEnvelope(code: string, message: string): ApiErrorEnvelope {
  return { error: { code, message } };
}

type PostBodyJson = {
  scenario?: unknown;
  includePrediction?: unknown;
};

/** POST /api/dashboard/twin/engine — AI-Twin engine orchestration (DEE-36). */
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

  let scenario: string | null | undefined;
  if ("scenario" in parsed) {
    const raw = parsed.scenario;
    if (raw === null || raw === undefined) {
      scenario = undefined;
    } else if (typeof raw !== "string") {
      return NextResponse.json(
        validationErrorEnvelope("INVALID_BODY", "scenario must be a string, null, or omitted."),
        { status: 400 },
      );
    } else {
      const t = raw.trim();
      scenario = t.length === 0 ? undefined : t;
    }
  }

  let includePrediction = false;
  if ("includePrediction" in parsed && parsed.includePrediction !== undefined) {
    if (typeof parsed.includePrediction !== "boolean") {
      return NextResponse.json(
        validationErrorEnvelope("INVALID_BODY", "includePrediction must be a boolean when provided."),
        { status: 400 },
      );
    }
    includePrediction = parsed.includePrediction;
  }

  try {
    const runtimeDb = await getWaiaRuntimeDb();
    const body = await runTwinEngineForRuntimeAsync(runtimeDb, {
      userId,
      scenario,
      includePrediction,
    });
    return NextResponse.json(body, {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    if (err instanceof TwinEngineScenarioTooLongError) {
      return NextResponse.json(
        validationErrorEnvelope(
          "SCENARIO_TOO_LONG",
          `scenario must not exceed ${MAX_SCENARIO_CHARS} characters.`,
        ),
        { status: 400 },
      );
    }
    return NextResponse.json(
      validationErrorEnvelope("INTERNAL_ERROR", "Something went wrong."),
      { status: 500 },
    );
  }
}
