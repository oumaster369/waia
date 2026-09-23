import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { readStoredObservationFreshness } from "@/lib/trader/admin/cockpit-read";
import { serveAdminCockpit } from "@/lib/trader/admin/cockpit-stream";

export const dynamic = "force-dynamic";

/** GET /api/trader/admin/cockpit/stream — SSE transport for the cockpit read. */
export async function GET(request: Request) {
  return serveAdminCockpit(request, {
    ...createProductionAdminRouteDeps(),
    readObservationFreshness: readStoredObservationFreshness,
  });
}
