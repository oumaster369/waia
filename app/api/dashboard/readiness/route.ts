import { NextResponse } from "next/server";

import type { DashboardReadinessApiResponse } from "@/lib/dashboard/dashboard-readiness-api.types";
import { getDashboardReadinessPayload } from "@/lib/dashboard/dashboard-readiness-source";
import { computeReadinessResult } from "@/lib/readiness/readiness";

export const dynamic = "force-dynamic";

/**
 * Backend readiness envelope for dashboard clients.
 * Stable fields: readinessInput + readinessResult (+ hintsByIndicator stubs until DEE-17).
 */
export async function GET() {
  const payload = await getDashboardReadinessPayload();
  const readinessResult = computeReadinessResult(payload.readinessInput);
  const body: DashboardReadinessApiResponse = {
    ...payload,
    readinessResult,
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
