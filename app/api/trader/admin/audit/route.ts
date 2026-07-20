import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminAuditList } from "@/lib/waia-core/audit/admin-route-handler";

export const dynamic = "force-dynamic";

/** GET /api/trader/admin/audit — org-scoped audit log list. */
export async function GET(request: Request) {
  return runAdminRoute("trader_admin_audit_list", () =>
    handleAdminAuditList(request, createProductionAdminRouteDeps()),
  );
}
