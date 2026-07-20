import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminInvoicesListGet } from "@/lib/trader/billing/admin-route-handler";

export const dynamic = "force-dynamic";

/** GET /api/trader/admin/invoices — invoice list by exchange account. */
export async function GET(request: Request) {
  return runAdminRoute("trader_admin_invoices_list", () =>
    handleAdminInvoicesListGet(request, createProductionAdminRouteDeps()),
  );
}
