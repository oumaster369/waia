import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleReportingPeriodsGet } from "@/lib/trader/admin-console/handlers/reporting-periods";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("trader_admin_console_reporting_periods", () =>
    handleAdminConsoleReportingPeriodsGet(request, createProductionAdminRouteDeps()),
  );
}
