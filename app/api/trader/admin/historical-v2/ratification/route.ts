import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import {
  handleHistoricalRatificationAdminGetV2,
  handleHistoricalRatificationAdminPostV2,
} from "@/lib/trader/historical-simulation-v2/ratification-admin-handler-v2";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("trader_admin_historical_v2_ratification_get", () =>
    handleHistoricalRatificationAdminGetV2(request, createProductionAdminRouteDeps()));
}

export async function POST(request: Request) {
  return runAdminRoute("trader_admin_historical_v2_ratification_post", () =>
    handleHistoricalRatificationAdminPostV2(request, createProductionAdminRouteDeps()));
}
