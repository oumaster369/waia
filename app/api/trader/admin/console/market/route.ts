import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleMarketGet } from "@/lib/trader/admin-console/handlers/market";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return runAdminRoute("trader_admin_console_market", () =>
    handleAdminConsoleMarketGet(request, createProductionAdminRouteDeps()),
  );
}
