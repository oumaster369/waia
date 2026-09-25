import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleInvoiceCommandPost } from "@/lib/trader/admin-console/handlers/invoice-commands";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await context.params;
  return runAdminRoute("trader_admin_console_invoice_detail", () =>
    handleAdminConsoleInvoiceCommandPost(request, createProductionAdminRouteDeps(), invoiceId),
  );
}
