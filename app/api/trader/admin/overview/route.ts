import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminOverviewGet } from "@/lib/trader/admin-overview-handler";

export const dynamic = "force-dynamic";

/** GET /api/trader/admin/overview — read-only org admin summary. */
export async function GET(request: Request) {
  return runAdminRoute("trader_admin_overview", () =>
    handleAdminOverviewGet(request, createProductionAdminRouteDeps()),
  );
}
