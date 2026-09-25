import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleResearchDetailGet } from "@/lib/trader/admin-console/handlers/research-detail";
import { adminClientError } from "@/lib/trader/admin-route-shared";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const ids = new URL(request.url).searchParams.getAll("run_id");
  return runAdminRoute("trader_admin_console_research_compare", () =>
    ids.length < 2
      ? Promise.resolve(adminClientError(400, "BAD_REQUEST", "Choose 2–4 runs."))
      : handleAdminConsoleResearchDetailGet(request, createProductionAdminRouteDeps(), ids),
  );
}
