import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleInvoicesGet } from "@/lib/trader/admin-console/handlers/invoices";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runAdminRoute("trader_admin_console_invoices", () =>
    handleAdminConsoleInvoicesGet(request, createProductionAdminRouteDeps()),
  );
}
