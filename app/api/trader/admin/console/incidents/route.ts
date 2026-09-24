import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { runAdminRoute } from "@/lib/trader/admin-route-http";
import { handleAdminConsoleIncidentsGet } from "@/lib/trader/admin-console/handlers/incidents";
import { handleAdminConsoleIncidentPost } from "@/lib/trader/admin-console/handlers/incident-commands";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return runAdminRoute("trader_admin_console_incidents", () =>
    handleAdminConsoleIncidentPost(request, createProductionAdminRouteDeps()),
  );
}

export async function GET(request: Request) {
  return runAdminRoute("trader_admin_console_incidents", () =>
    handleAdminConsoleIncidentsGet(request, createProductionAdminRouteDeps()),
  );
}
