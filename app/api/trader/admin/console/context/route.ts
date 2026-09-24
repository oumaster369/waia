import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleContextGet } from "@/lib/trader/admin-console/handlers/context";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return runAdminRoute("trader_admin_console_context", () =>
    handleAdminConsoleContextGet(request, createProductionAdminRouteDeps()),
  );
}
