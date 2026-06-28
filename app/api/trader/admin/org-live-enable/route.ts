import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminOrgLiveEnableGet } from "@/lib/trader/live/admin-route-handler";

export const dynamic = "force-dynamic";

/** GET /api/trader/admin/org-live-enable — org live enable read surfaces. */
export async function GET(request: Request) {
  return runAdminRoute("trader_admin_org_live_enable", () =>
    handleAdminOrgLiveEnableGet(request, createProductionAdminRouteDeps()),
  );
}
