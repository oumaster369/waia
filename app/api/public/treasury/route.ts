import { NextResponse } from "next/server";

import { emitWaiaRuntimeRouteTelemetry } from "@/lib/observability/waia-runtime-route-telemetry";
import { handlePublicTreasuryGet } from "@/lib/waia-core/treasury/public/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  const result = await handlePublicTreasuryGet();
  emitWaiaRuntimeRouteTelemetry({
    event: "waia_runtime_route",
    route: "public_treasury",
    waia_db_backend: result.waiaDbBackend,
    http_status: result.status,
    outcome: result.outcome,
    duration_ms: Date.now() - startedAt,
    error_class: result.errorClass,
    pg_close_outcome: result.pgCloseOutcome,
  });
  return NextResponse.json(result.body, {
    status: result.status,
    headers: {
      "Cache-Control":
        result.status === 200 ? "public, max-age=0, must-revalidate" : "no-store",
    },
  });
}
