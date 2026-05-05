import { NextResponse } from "next/server";

import type { DashboardReadinessApiResponse } from "@/lib/dashboard/dashboard-readiness-api.types";
import { getDashboardReadinessPayloadForUser } from "@/lib/dashboard/dashboard-readiness-source";
import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import { computeReadinessResult } from "@/lib/readiness/readiness";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";

export const dynamic = "force-dynamic";

/**
 * Backend readiness envelope for dashboard clients.
 * Stable fields: readinessInput + readinessResult (+ hintsByIndicator stubs until DEE-17).
 */
export async function GET() {
  const userId = await getOptionalSessionUserId();
  if (!userId) {
    return NextResponse.json(
      {
        error: { code: "UNAUTHORIZED", message: "Session required." },
      } satisfies ApiErrorEnvelope,
      { status: 401 },
    );
  }

  const payload = await getDashboardReadinessPayloadForUser(userId);
  const readinessResult = computeReadinessResult(payload.readinessInput);
  const body: DashboardReadinessApiResponse = {
    ...payload,
    readinessResult,
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
