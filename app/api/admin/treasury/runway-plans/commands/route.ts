import { runAdminRoute } from "@/lib/waia-core/permissions/admin-http-run";
import { createProductionAdminRouteDeps } from "@/lib/waia-core/permissions/admin-http-deps";
import { handleTreasuryRunwayPlanCommandsPost } from "@/lib/waia-core/treasury/admin/handlers";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return runAdminRoute("admin_treasury_runway_plan_commands", () =>
    handleTreasuryRunwayPlanCommandsPost(request, createProductionAdminRouteDeps()),
  );
}
