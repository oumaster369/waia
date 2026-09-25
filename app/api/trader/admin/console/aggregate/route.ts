import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleAggregateGet } from "@/lib/trader/admin-console/handlers/aggregate";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return runAdminRoute("trader_admin_console_aggregate", () =>
    handleAdminConsoleAggregateGet(request, createProductionAdminRouteDeps()),
  );
}
