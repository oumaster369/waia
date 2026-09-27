import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminReportingPeriodBasisGet } from "@/lib/trader/billing/reporting-period-basis-read";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ periodId: string }> }) {
  return runAdminRoute("trader_admin_reporting_period_basis", async () =>
    handleAdminReportingPeriodBasisGet(request, (await context.params).periodId, createProductionAdminRouteDeps()));
}
