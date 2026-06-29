import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminReportingPeriodCommandPost } from "@/lib/trader/billing/admin-route-handler";

export const dynamic = "force-dynamic";

/** POST /api/trader/admin/reporting-periods/commands — reporting period close + draft materialization. */
export async function POST(request: Request) {
  return runAdminRoute("trader_admin_reporting_period_commands", () =>
    handleAdminReportingPeriodCommandPost(request, createProductionAdminRouteDeps()),
  );
}
