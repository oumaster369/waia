import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminRuntimeAuthorityGet } from "@/lib/trader/runtime-authority/v2";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return runAdminRoute("trader_admin_runtime_health", () =>
    handleAdminRuntimeAuthorityGet(request, createProductionAdminRouteDeps()));
}
