import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleExportGet } from "@/lib/trader/admin-console/handlers/export";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await context.params;
  return runAdminRoute("trader_admin_console_export", () =>
    handleAdminConsoleExportGet(request, createProductionAdminRouteDeps(), invoiceId),
  );
}
