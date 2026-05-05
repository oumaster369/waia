import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import type {
  DiaryEntriesListApiResponse,
  DiaryEntryAppendApiResponse,
  DiaryMemoryEntryDto,
} from "@/lib/dashboard/diary-memory-api.types";
import { MAX_DIARY_BODY_CHARS } from "@/lib/dashboard/diary-body-limits";
import {
  appendDiaryEntryForUser,
  listDiaryEntriesForUser,
} from "@/lib/twin-persistence/diary-memory";

export const dynamic = "force-dynamic";

function unauthorizedEnvelope(): ApiErrorEnvelope {
  return { error: { code: "UNAUTHORIZED", message: "Session required." } };
}

function validationErrorEnvelope(code: string, message: string): ApiErrorEnvelope {
  return { error: { code, message } };
}

function toEntryDto(r: { id: string; body: string; createdAt: Date }): DiaryMemoryEntryDto {
  return {
    id: r.id,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
  };
}

type PostBodyJson = {
  body?: unknown;
  idempotencyKey?: unknown;
};

/** GET /api/dashboard/diary/entries — list diary entries for the signed-in user (DEE-27). */
export async function GET() {
  const userId = await getOptionalSessionUserId();
  if (!userId) {
    return NextResponse.json(unauthorizedEnvelope(), { status: 401 });
  }

  const db = getDb();
  const entries = listDiaryEntriesForUser(db, userId);
  const body: DiaryEntriesListApiResponse = { entries };
  return NextResponse.json(body, {
    status: 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}

/** POST /api/dashboard/diary/entries — append one diary entry (DEE-27). */
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

  const rawBody = parsed.body;
  if (typeof rawBody !== "string") {
    return NextResponse.json(
      validationErrorEnvelope("INVALID_BODY", "body must be a string."),
      { status: 400 },
    );
  }

  const trimmed = rawBody.trim();
  if (trimmed.length === 0) {
    return NextResponse.json(
      validationErrorEnvelope("EMPTY_MESSAGE", "body must not be empty or whitespace."),
      { status: 400 },
    );
  }

  if (trimmed.length > MAX_DIARY_BODY_CHARS) {
    return NextResponse.json(
      validationErrorEnvelope(
        "BODY_TOO_LONG",
        `body must not exceed ${MAX_DIARY_BODY_CHARS} characters.`,
      ),
      { status: 400 },
    );
  }

  let idempotencyKey: string | null | undefined;
  const rawKey = parsed.idempotencyKey;
  if (rawKey !== undefined && rawKey !== null) {
    if (typeof rawKey !== "string") {
      return NextResponse.json(
        validationErrorEnvelope("INVALID_BODY", "idempotencyKey must be a string when provided."),
        { status: 400 },
      );
    }
    const trimmedKey = rawKey.trim();
    idempotencyKey = trimmedKey.length > 0 ? trimmedKey : null;
  }

  const persisted = appendDiaryEntryForUser(getDb(), {
    userId,
    body: trimmed,
    idempotencyKey: idempotencyKey ?? null,
  });

  const dto: DiaryEntryAppendApiResponse = {
    entry: toEntryDto(persisted),
    replayed: persisted.replayed,
  };

  return NextResponse.json(dto, {
    status: 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}
