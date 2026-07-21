import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminFhvOperationsCommandPost } from "@/lib/trader/fhv-admin-handler";

export const dynamic = "force-dynamic";

/** POST /api/trader/admin/fhv-operations/commands — authenticated signed operator commands. */
export async function POST(request: Request) {
  return runAdminRoute("trader_admin_fhv_operations_commands", () =>
    handleAdminFhvOperationsCommandPost(request, createProductionAdminRouteDeps()),
  );
}
