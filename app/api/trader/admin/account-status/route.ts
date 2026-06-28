import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminAccountStatusGet } from "@/lib/trader/settlement/admin-route-handler";

export const dynamic = "force-dynamic";

/** GET /api/trader/admin/account-status — account status projection + events. */
export async function GET(request: Request) {
  return runAdminRoute("trader_admin_account_status", () =>
    handleAdminAccountStatusGet(request, createProductionAdminRouteDeps()),
  );
}
