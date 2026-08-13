import { runAdminRoute } from "@/lib/waia-core/permissions/admin-http-run";
import { createProductionAdminRouteDeps } from "@/lib/waia-core/permissions/admin-http-deps";
import {
  handleTreasuryReconciliationsGet,
  handleTreasuryReconciliationsPatch,
} from "@/lib/waia-core/treasury/admin/handlers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("admin_treasury_reconciliations", () =>
    handleTreasuryReconciliationsGet(request, createProductionAdminRouteDeps()),
  );
}

export async function PATCH() {
  return runAdminRoute("admin_treasury_reconciliations", () =>
    handleTreasuryReconciliationsPatch(),
  );
}
