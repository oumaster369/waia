import { runAdminRoute } from "@/lib/waia-core/permissions/admin-http-run";
import { createProductionAdminRouteDeps } from "@/lib/waia-core/permissions/admin-http-deps";
import { handleTreasuryOverviewCountsGet } from "@/lib/waia-core/treasury/admin/handlers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("admin_treasury_overview_counts", () =>
    handleTreasuryOverviewCountsGet(request, createProductionAdminRouteDeps()),
  );
}
