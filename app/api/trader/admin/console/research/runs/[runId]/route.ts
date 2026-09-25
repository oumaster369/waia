import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleResearchDetailGet } from "@/lib/trader/admin-console/handlers/research-detail";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  return runAdminRoute("trader_admin_console_research_detail", () =>
    handleAdminConsoleResearchDetailGet(request, createProductionAdminRouteDeps(), [runId]),
  );
}
