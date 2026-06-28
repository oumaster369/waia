import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminStrategyPromotionsGet } from "@/lib/trader/validation-gate/admin-route-handler";

export const dynamic = "force-dynamic";

/** GET /api/trader/admin/strategy-promotions — promotion read surfaces. */
export async function GET(request: Request) {
  return runAdminRoute("trader_admin_strategy_promotions", () =>
    handleAdminStrategyPromotionsGet(request, createProductionAdminRouteDeps()),
  );
}
