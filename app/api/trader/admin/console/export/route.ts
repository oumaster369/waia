import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleExportGet } from "@/lib/trader/admin-console/handlers/export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("trader_admin_console_export", () =>
    handleAdminConsoleExportGet(request, createProductionAdminRouteDeps()),
  );
}
