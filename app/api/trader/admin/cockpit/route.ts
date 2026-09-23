import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import {
  handleAdminCockpitRead,
  readStoredObservationFreshness,
} from "@/lib/trader/admin/cockpit-read";

export const dynamic = "force-dynamic";

/** GET /api/trader/admin/cockpit — release, runtime, freshness, and C3 facts from existing reads. */
export async function GET(request: Request) {
  return runAdminRoute("trader_admin_cockpit", () =>
    handleAdminCockpitRead(request, {
      ...createProductionAdminRouteDeps(),
      readObservationFreshness: readStoredObservationFreshness,
    }),
  );
}
