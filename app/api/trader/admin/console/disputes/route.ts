import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleDisputesGet } from "@/lib/trader/admin-console/handlers/disputes";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("trader_admin_console_disputes", () =>
    handleAdminConsoleDisputesGet(request, createProductionAdminRouteDeps()),
  );
}
