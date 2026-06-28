import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminOrgLiveEnableCommandPost } from "@/lib/trader/live/admin-route-handler";

export const dynamic = "force-dynamic";

/** POST /api/trader/admin/org-live-enable/commands — org live enable mutations. */
export async function POST(request: Request) {
  return runAdminRoute("trader_admin_org_live_enable_commands", () =>
    handleAdminOrgLiveEnableCommandPost(request, createProductionAdminRouteDeps()),
  );
}
