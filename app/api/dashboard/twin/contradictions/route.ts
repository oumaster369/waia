import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { MAX_SCENARIO_CHARS } from "@/lib/dashboard/twin-contradiction-detector-api.types";
import type { TwinContradictionDetectorApiResponse } from "@/lib/dashboard/twin-contradiction-detector-api.types";
import {
  runTwinContradictionDetectorForUser,
} from "@/lib/reasoning/twin-contradiction-detector";

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

  const db = getDb();
  const body: TwinContradictionDetectorApiResponse = runTwinContradictionDetectorForUser(
    db,
    userId,
    scenarioForDetector ? { scenarioForRulesAndRetrieval: scenarioForDetector } : {},
  );

  return NextResponse.json(body, {
    status: 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}
