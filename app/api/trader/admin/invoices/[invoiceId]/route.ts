import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminInvoiceGet } from "@/lib/trader/billing/admin-route-handler";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ invoiceId: string }> };

/** GET /api/trader/admin/invoices/[invoiceId] — single invoice read. */
export async function GET(request: Request, context: RouteContext) {
  const { invoiceId } = await context.params;
  return runAdminRoute("trader_admin_invoice_detail", () =>
    handleAdminInvoiceGet(request, createProductionAdminRouteDeps(), invoiceId),
  );
}
