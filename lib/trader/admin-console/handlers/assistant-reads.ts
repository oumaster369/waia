import type {
  AdminRouteHandlerDeps,
  AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { handleAdminConsoleAccountsGet } from "@/lib/trader/admin-console/handlers/accounts";
import { handleAdminConsoleClientsGet } from "@/lib/trader/admin-console/handlers/clients";
import { handleAdminConsoleIncidentsGet } from "@/lib/trader/admin-console/handlers/incidents";
import { handleAdminConsoleInvoicesGet } from "@/lib/trader/admin-console/handlers/invoices";
import { handleAdminConsoleOrdersGet } from "@/lib/trader/admin-console/handlers/orders";
import { handleAdminConsoleOverviewGet } from "@/lib/trader/admin-console/handlers/overview";
import { handleAdminConsoleResearchRunsGet } from "@/lib/trader/admin-console/handlers/research-runs";
import { handleAdminConsoleStrategiesGet } from "@/lib/trader/admin-console/handlers/strategies";
import { handleAdminConsoleSystemGet } from "@/lib/trader/admin-console/handlers/system";

const SYSTEM_TOOLS = new Set(["system_status", "list_jobs", "release_info"]);

export async function readAssistantTool(
  tool: string,
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  url.pathname = "/api/trader/admin/console/assistant";
  const read = new Request(url, {
    headers: request.headers,
  });
  if (tool === "get_overview") return handleAdminConsoleOverviewGet(read, deps);
  if (tool === "list_accounts") return handleAdminConsoleAccountsGet(read, deps);
  if (tool === "list_orders") return handleAdminConsoleOrdersGet(read, deps);
  if (tool === "list_clients") return handleAdminConsoleClientsGet(read, deps);
  if (tool === "list_invoices") return handleAdminConsoleInvoicesGet(read, deps);
  if (tool === "strategy_performance") return handleAdminConsoleStrategiesGet(read, deps);
  if (tool === "list_research_runs") return handleAdminConsoleResearchRunsGet(read, deps);
  if (tool === "list_incidents") return handleAdminConsoleIncidentsGet(read, deps);
  if (SYSTEM_TOOLS.has(tool)) return handleAdminConsoleSystemGet(read, deps);
  throw new Error(`Assistant tool is not wired: ${tool}`);
}
