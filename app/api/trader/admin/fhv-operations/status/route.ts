import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminFhvOperationsStatusGet } from "@/lib/trader/fhv-admin-handler";

export const dynamic = "force-dynamic";

/** GET /api/trader/admin/fhv-operations/status — bounded FHV operator status. */
export async function GET(request: Request) {
  return runAdminRoute("trader_admin_fhv_operations_status", () =>
    handleAdminFhvOperationsStatusGet(request, createProductionAdminRouteDeps()),
  );
}
