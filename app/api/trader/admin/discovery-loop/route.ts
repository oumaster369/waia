import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminDiscoveryLoopGet } from "@/lib/trader/admin-console/handlers/discovery-loop";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("trader_admin_discovery_loop", () =>
    handleAdminDiscoveryLoopGet(request, createProductionAdminRouteDeps()),
  );
}
