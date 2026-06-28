import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminOrganizationsList } from "@/lib/waia-core/permissions/admin-route-handler";

export const dynamic = "force-dynamic";

/** GET /api/trader/admin/organizations — list organizations for admin console. */
export async function GET() {
  return runAdminRoute("trader_admin_organizations_list", () =>
    handleAdminOrganizationsList(createProductionAdminRouteDeps()),
  );
}
