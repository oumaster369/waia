import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminFhvOperationsDetailGet } from "@/lib/trader/fhv-admin-handler";

export const dynamic = "force-dynamic";

/** GET /api/trader/admin/fhv-operations/detail — paginated FHV detail snapshots. */
export async function GET(request: Request) {
  return runAdminRoute("trader_admin_fhv_operations_detail", () =>
    handleAdminFhvOperationsDetailGet(request, createProductionAdminRouteDeps()),
  );
}
