import { NextResponse } from "next/server";

import { emitWaiaRuntimeRouteTelemetry } from "@/lib/observability/waia-runtime-route-telemetry";
import { readPublicWorkPlan } from "@/lib/public-work-plan/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  const result = await readPublicWorkPlan();
  emitWaiaRuntimeRouteTelemetry({
    event: "waia_runtime_route",
    route: "public_work_plan",
    http_status: result.status,
    outcome: result.outcome,
    duration_ms: Date.now() - startedAt,
    error_class: result.errorClass,
  });
  return NextResponse.json(result.body, {
    status: result.status,
    headers: {
      "Cache-Control":
        result.body.state === "available"
          ? "public, max-age=60, stale-while-revalidate=240"
          : "no-store",
    },
  });
}
