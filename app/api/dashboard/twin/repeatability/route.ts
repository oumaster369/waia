import { NextResponse } from "next/server";

import { getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import type { TwinRepeatabilityApiResponse } from "@/lib/dashboard/twin-repeatability-api.types";
import { resolveTwinPersistence } from "@/lib/persistence/runtime";
import { analyzeRepeatability } from "@/lib/reasoning/twin-repeatability-analyzer";

export const dynamic = "force-dynamic";

function unauthorizedEnvelope(): ApiErrorEnvelope {
  return { error: { code: "UNAUTHORIZED", message: "Session required." } };
}

/** GET /api/dashboard/twin/repeatability — aggregated repeatability patterns (DEE-28). */
export async function GET(request: Request) {
  const userId = await getOptionalSessionUserId();
  if (!userId) {
    return NextResponse.json(unauthorizedEnvelope(), { status: 401 });
  }

  const url = new URL(request.url);
  const scenarioParam = url.searchParams.get("scenario");
  const scenarioText =
    scenarioParam != null && scenarioParam.trim().length > 0 ? scenarioParam : undefined;

  const runtime = await getWaiaRuntimeDb();
  const body: TwinRepeatabilityApiResponse =
    runtime.kind === "sqlite"
      ? analyzeRepeatability(runtime.db, userId, { scenarioText })
      : await resolveTwinPersistence(runtime).analyzeRepeatabilityForUser(userId, { scenarioText });

  return NextResponse.json(body, {
    status: 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}
