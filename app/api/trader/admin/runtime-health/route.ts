import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminRuntimeHealth } from "@/lib/trader/runtime-health/admin-route-handler";

export const dynamic = "force-dynamic";

/** GET /api/trader/admin/runtime-health — execution host health probe. */
export async function GET(request: Request) {
  return runAdminRoute("trader_admin_runtime_health", () =>
    handleAdminRuntimeHealth(request, createProductionAdminRouteDeps()),
  );
}
