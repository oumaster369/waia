import { NextResponse } from "next/server";

import { getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import type { TwinPredictionVerificationListApiResponse } from "@/lib/dashboard/twin-prediction-verification-api.types";
import { TWIN_PREDICTION_VERIFICATION_SCHEMA_VERSION } from "@/lib/dashboard/twin-prediction-verification-api.types";
import { resolveTwinPersistence } from "@/lib/persistence/runtime";
import { listTwinPredictionVerificationsForUser } from "@/lib/twin-persistence/twin-prediction-verifications";

export const dynamic = "force-dynamic";

function unauthorizedEnvelope(): ApiErrorEnvelope {
  return { error: { code: "UNAUTHORIZED", message: "Session required." } };
}

function validationErrorEnvelope(code: string, message: string): ApiErrorEnvelope {
  return { error: { code, message } };
}

/** GET /api/dashboard/twin/prediction/verifications — latest verifications for session user (DEE-34). */
export async function GET(request: Request) {
  const userId = await getOptionalSessionUserId();
  if (!userId) {
    return NextResponse.json(unauthorizedEnvelope(), { status: 401 });
  }

  let limit: number | undefined;
  const { searchParams } = new URL(request.url);
  const rawLimit = searchParams.get("limit");
  if (rawLimit !== null && rawLimit !== "") {
    const n = Number(rawLimit);
    if (!Number.isFinite(n) || n < 1) {
      return NextResponse.json(
        validationErrorEnvelope("INVALID_QUERY", "limit must be a positive number when provided."),
        { status: 400 },
      );
    }
    limit = n;
  }

  const runtime = await getWaiaRuntimeDb();
  const verifications =
    runtime.kind === "sqlite"
      ? listTwinPredictionVerificationsForUser(runtime.db, userId, limit)
      : await resolveTwinPersistence(runtime).listTwinPredictionVerificationsForUser(userId, limit);

  const body: TwinPredictionVerificationListApiResponse = {
    schemaVersion: TWIN_PREDICTION_VERIFICATION_SCHEMA_VERSION,
    verifications,
  };

  return NextResponse.json(body, {
    status: 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}
