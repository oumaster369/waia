import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminBillingDisputeCommandPost } from "@/lib/trader/billing/admin-route-handler";

export const dynamic = "force-dynamic";

/** POST /api/trader/admin/billing-disputes/commands — billing dispute mutations. */
export async function POST(request: Request) {
  return runAdminRoute("trader_admin_billing_dispute_commands", () =>
    handleAdminBillingDisputeCommandPost(request, createProductionAdminRouteDeps()),
  );
}
