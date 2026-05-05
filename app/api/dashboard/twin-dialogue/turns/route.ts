import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import type { TwinDialogueTurnsMemoryApiResponse } from "@/lib/dashboard/twin-dialogue-memory-api.types";
import { listTwinDialogueTurnsForUser } from "@/lib/twin-persistence/loader";

export const dynamic = "force-dynamic";

function unauthorizedEnvelope(): ApiErrorEnvelope {
  return { error: { code: "UNAUTHORIZED", message: "Session required." } };
}

/** GET /api/dashboard/twin-dialogue/turns — Twin dialogue memory for the signed-in user (DEE-26). */
export async function GET() {
  const userId = await getOptionalSessionUserId();
  if (!userId) {
    return NextResponse.json(unauthorizedEnvelope(), { status: 401 });
  }

  const db = getDb();
  const turns = listTwinDialogueTurnsForUser(db, userId);

  const body: TwinDialogueTurnsMemoryApiResponse = { turns };
  return NextResponse.json(body, {
    status: 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}
