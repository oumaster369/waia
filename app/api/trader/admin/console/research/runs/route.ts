import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleResearchRunsGet } from "@/lib/trader/admin-console/handlers/research-runs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("trader_admin_console_research_runs", () =>
    handleAdminConsoleResearchRunsGet(request, createProductionAdminRouteDeps()),
  );
}
