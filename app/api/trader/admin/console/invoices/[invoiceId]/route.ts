import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleInvoiceDetailGet } from "@/lib/trader/admin-console/handlers/invoices";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await context.params;
  return runAdminRoute("trader_admin_console_invoice_detail", () =>
    handleAdminConsoleInvoiceDetailGet(request, createProductionAdminRouteDeps(), invoiceId),
  );
}
