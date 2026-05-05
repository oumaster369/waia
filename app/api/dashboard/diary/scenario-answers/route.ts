import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import type {
  ScenarioAnswerAppendApiResponse,
  ScenarioAnswerMemoryDto,
  ScenarioAnswersListApiResponse,
} from "@/lib/dashboard/scenario-memory-api.types";
import {
  MAX_SCENARIO_KEY_CHARS,
  MAX_SCENARIO_PAYLOAD_JSON_CHARS,
  appendScenarioAnswerForUser,
  listScenarioAnswersForUser,
  stringifyScenarioPayloadForStorage,
} from "@/lib/twin-persistence/diary-memory";

export const dynamic = "force-dynamic";

function unauthorizedEnvelope(): ApiErrorEnvelope {
  return { error: { code: "UNAUTHORIZED", message: "Session required." } };
}

function validationErrorEnvelope(code: string, message: string): ApiErrorEnvelope {
  return { error: { code, message } };
}

function toAnswerDto(r: {
  id: string;
  scenarioKey: string;
  payload: unknown;
  createdAt: Date;
}): ScenarioAnswerMemoryDto {
  return {
    id: r.id,
    scenarioKey: r.scenarioKey,
    payload: r.payload,
    createdAt: r.createdAt.toISOString(),
  };
}

type PostBodyJson = {
  scenarioKey?: unknown;
  payload?: unknown;
  idempotencyKey?: unknown;
};

/** GET /api/dashboard/diary/scenario-answers — list answers for the signed-in user's twin profile (DEE-27). */
export async function GET() {
  const userId = await getOptionalSessionUserId();
  if (!userId) {
    return NextResponse.json(unauthorizedEnvelope(), { status: 401 });
  }

  const db = getDb();
  const answers = listScenarioAnswersForUser(db, userId);
  const body: ScenarioAnswersListApiResponse = { answers };
  return NextResponse.json(body, {
    status: 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}

/** POST /api/dashboard/diary/scenario-answers — append one scenario answer (DEE-27). */
export async function POST(request: Request) {
  const userId = await getOptionalSessionUserId();
  if (!userId) {
    return NextResponse.json(
      validationErrorEnvelope("UNAUTHORIZED", "Session required."),
      { status: 401 },
    );
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

  const rawKey = parsed.scenarioKey;
  if (typeof rawKey !== "string") {
    return NextResponse.json(
      validationErrorEnvelope("INVALID_BODY", "scenarioKey must be a string."),
      { status: 400 },
    );
  }

  const scenarioKey = rawKey.trim();
  if (scenarioKey.length === 0) {
    return NextResponse.json(
      validationErrorEnvelope("EMPTY_SCENARIO_KEY", "scenarioKey must not be empty or whitespace."),
      { status: 400 },
    );
  }

  if (scenarioKey.length > MAX_SCENARIO_KEY_CHARS) {
    return NextResponse.json(
      validationErrorEnvelope(
        "SCENARIO_KEY_TOO_LONG",
        `scenarioKey must not exceed ${MAX_SCENARIO_KEY_CHARS} characters.`,
      ),
      { status: 400 },
    );
  }

  if (!("payload" in parsed)) {
    return NextResponse.json(
      validationErrorEnvelope("INVALID_BODY", "payload is required."),
      { status: 400 },
    );
  }

  const payloadJson = stringifyScenarioPayloadForStorage(parsed.payload);
  if (payloadJson === null) {
    try {
      JSON.stringify(parsed.payload);
    } catch {
      return NextResponse.json(
        validationErrorEnvelope("INVALID_PAYLOAD", "payload must be JSON-serializable."),
        { status: 400 },
      );
    }
    return NextResponse.json(
      validationErrorEnvelope(
        "PAYLOAD_TOO_LARGE",
        `serialized payload must not exceed ${MAX_SCENARIO_PAYLOAD_JSON_CHARS} characters.`,
      ),
      { status: 400 },
    );
  }

  let idempotencyKey: string | null | undefined;
  const rawIdem = parsed.idempotencyKey;
  if (rawIdem !== undefined && rawIdem !== null) {
    if (typeof rawIdem !== "string") {
      return NextResponse.json(
        validationErrorEnvelope("INVALID_BODY", "idempotencyKey must be a string when provided."),
        { status: 400 },
      );
    }
    const trimmedKey = rawIdem.trim();
    idempotencyKey = trimmedKey.length > 0 ? trimmedKey : null;
  }

  const persisted = appendScenarioAnswerForUser(getDb(), {
    userId,
    scenarioKey,
    payloadJson,
    idempotencyKey: idempotencyKey ?? null,
  });

  const dto: ScenarioAnswerAppendApiResponse = {
    answer: toAnswerDto(persisted),
    replayed: persisted.replayed,
  };

  return NextResponse.json(dto, {
    status: 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}
