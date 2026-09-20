import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminConnectedAccountsGet } from "@/lib/trader/credentials/admin-connected-accounts-handler";

export const dynamic = "force-dynamic";

/** GET /api/trader/admin/connected-accounts — personal HTX cabinets only. */
export async function GET() {
  return runAdminRoute("trader_admin_connected_accounts", () =>
    handleAdminConnectedAccountsGet(createProductionAdminRouteDeps()),
  );
}
