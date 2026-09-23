import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleOrdersGet } from "@/lib/trader/admin-console/handlers/orders";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("trader_admin_console_orders", () =>
    handleAdminConsoleOrdersGet(request, createProductionAdminRouteDeps()),
  );
}
