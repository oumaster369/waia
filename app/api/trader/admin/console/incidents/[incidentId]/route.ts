import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleIncidentsGet } from "@/lib/trader/admin-console/handlers/incidents";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ incidentId: string }> }) {
  const { incidentId } = await context.params;
  return runAdminRoute("trader_admin_console_incidents", () =>
    handleAdminConsoleIncidentsGet(request, createProductionAdminRouteDeps(), incidentId),
  );
}
