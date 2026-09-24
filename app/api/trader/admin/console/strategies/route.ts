import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleStrategiesGet } from "@/lib/trader/admin-console/handlers/strategies";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("trader_admin_console_strategies", () =>
    handleAdminConsoleStrategiesGet(request, createProductionAdminRouteDeps()),
  );
}
