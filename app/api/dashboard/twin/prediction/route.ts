import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import type { TwinPredictionApiResponse } from "@/lib/dashboard/twin-prediction-api.types";
import { MAX_SCENARIO_CHARS, normalizeTwinPredictionScenario, runTwinPredictionForUser } from "@/lib/reasoning/twin-prediction";

export const dynamic = "force-dynamic";

type SubmitBodyJson = {
  scenario?: unknown;
};

function validationErrorEnvelope(code: string, message: string): ApiErrorEnvelope {
  return { error: { code, message } };
}

/** POST /api/dashboard/twin/prediction — forward-model Twin outcome for scenario (DEE-33). */
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

  const raw = parsed.scenario;
  if (typeof raw !== "string") {
    return NextResponse.json(
      validationErrorEnvelope("INVALID_BODY", "scenario must be a string."),
      { status: 400 },
    );
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return NextResponse.json(
      validationErrorEnvelope("EMPTY_SCENARIO", "scenario must not be empty or whitespace."),
      { status: 400 },
    );
  }

  if (trimmed.length > MAX_SCENARIO_CHARS) {
    return NextResponse.json(
      validationErrorEnvelope(
        "SCENARIO_TOO_LONG",
        `scenario must not exceed ${MAX_SCENARIO_CHARS} characters.`,
      ),
      { status: 400 },
    );
  }

  const db = getDb();
  if (normalizeTwinPredictionScenario(trimmed).length === 0) {
    return NextResponse.json(
      validationErrorEnvelope("INVALID_BODY", "scenario normalizes to empty text."),
      { status: 400 },
    );
  }

  const body: TwinPredictionApiResponse = runTwinPredictionForUser(db, userId, trimmed);

  return NextResponse.json(body, {
    status: 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}
