import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleClientsGet } from "@/lib/trader/admin-console/handlers/clients";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await context.params;
  return runAdminRoute("trader_admin_console_clients", () =>
    handleAdminConsoleClientsGet(request, createProductionAdminRouteDeps(), clientId),
  );
}
