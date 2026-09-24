import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminReportingPeriodsGet } from "@/lib/trader/billing/reporting-periods-read";

export const dynamic = "force-dynamic";

/** GET /api/trader/admin/reporting-periods — closed periods for one organization. */
export async function GET(request: Request) {
  return runAdminRoute("trader_admin_reporting_periods", () =>
    handleAdminReportingPeriodsGet(request, createProductionAdminRouteDeps()),
  );
}
