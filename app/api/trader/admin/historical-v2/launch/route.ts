import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleHistoricalSimulationAdminLaunchPostV2 } from
  "@/lib/trader/historical-simulation-v2/admin-launch-handler-v2";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return runAdminRoute("trader_admin_historical_v2_launch", () =>
    handleHistoricalSimulationAdminLaunchPostV2(request, createProductionAdminRouteDeps()));
}
