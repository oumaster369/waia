import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminFleetPortfolioGet } from "@/lib/trader/admin/fleet-portfolio-handler";

export const dynamic = "force-dynamic";

/** GET /api/trader/admin/portfolio — in-memory fan-out of scoped observations. */
export async function GET() {
  return runAdminRoute("trader_admin_fleet_portfolio", () =>
    handleAdminFleetPortfolioGet(createProductionAdminRouteDeps()),
  );
}
