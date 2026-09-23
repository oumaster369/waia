import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsolePositionsGet } from "@/lib/trader/admin-console/handlers/positions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("trader_admin_console_positions", () =>
    handleAdminConsolePositionsGet(request, createProductionAdminRouteDeps()),
  );
}
