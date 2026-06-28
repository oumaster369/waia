import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminStrategyPromotionCommandPost } from "@/lib/trader/validation-gate/admin-route-handler";

export const dynamic = "force-dynamic";

/** POST /api/trader/admin/strategy-promotions/commands — promotion governance mutations. */
export async function POST(request: Request) {
  return runAdminRoute("trader_admin_strategy_promotion_commands", () =>
    handleAdminStrategyPromotionCommandPost(request, createProductionAdminRouteDeps()),
  );
}
