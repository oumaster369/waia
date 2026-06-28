import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminBillingDisputesGet } from "@/lib/trader/billing/admin-route-handler";

export const dynamic = "force-dynamic";

/** GET /api/trader/admin/billing-disputes — dispute lookup. */
export async function GET(request: Request) {
  return runAdminRoute("trader_admin_billing_disputes", () =>
    handleAdminBillingDisputesGet(request, createProductionAdminRouteDeps()),
  );
}
