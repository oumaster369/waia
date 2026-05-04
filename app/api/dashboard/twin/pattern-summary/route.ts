import { NextResponse } from "next/server";

import { getDb } from "@/db/client";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import type { TwinPatternSummaryApiResponse } from "@/lib/dashboard/twin-pattern-summary-api.types";
import { getTwinPatternSummaryForUser } from "@/lib/reasoning/twin-pattern-summary";

export const dynamic = "force-dynamic";

function unauthorizedEnvelope(): ApiErrorEnvelope {
  return { error: { code: "UNAUTHORIZED", message: "Session required." } };
}

/** GET /api/dashboard/twin/pattern-summary — deterministic pattern summary over Twin memory (DEE-31). */
export async function GET() {
  const userId = await getOptionalSessionUserId();
  if (!userId) {
    return NextResponse.json(unauthorizedEnvelope(), { status: 401 });
  }

  const db = getDb();
  const body: TwinPatternSummaryApiResponse = getTwinPatternSummaryForUser(db, userId);

  return NextResponse.json(body, {
    status: 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}
