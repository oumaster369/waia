import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { handleAdminInvoiceCommandPost } from "@/lib/trader/billing/admin-route-handler";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ invoiceId: string }> };

/** POST /api/trader/admin/invoices/[invoiceId]/commands — invoice issuance commands. */
export async function POST(request: Request, context: RouteContext) {
  const { invoiceId } = await context.params;
  return runAdminRoute("trader_admin_invoice_commands", () =>
    handleAdminInvoiceCommandPost(request, createProductionAdminRouteDeps(), invoiceId),
  );
}
