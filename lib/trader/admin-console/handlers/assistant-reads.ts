import { handleAdminConsoleStrategyDetailGet } from "./strategy-detail";
import { handleAdminConsoleResearchDetailGet } from "./research-detail";
import {
  adminClientError,
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

import { handleAdminConsoleOrderDetailGet } from "@/lib/trader/admin-console/handlers/order-detail";
import { handleAdminConsoleAccountDetailGet } from "@/lib/trader/admin-console/handlers/account-detail";
import { handleAdminConsoleInvoiceDetailGet } from "@/lib/trader/admin-console/handlers/invoices";
import { handleAdminConsoleFillsGet } from "@/lib/trader/admin-console/handlers/fills";
import { handleAdminConsolePositionsGet } from "@/lib/trader/admin-console/handlers/positions";
import { handleAdminConsoleClosedTradesGet } from "@/lib/trader/admin-console/handlers/closed-trades";
import { handleAdminConsolePaymentsGet } from "@/lib/trader/admin-console/handlers/payments";
import { handleAdminConsoleCyclesGet } from "@/lib/trader/admin-console/handlers/cycles";
import { handleAdminConsoleCycleTraceGet } from "@/lib/trader/admin-console/handlers/cycle-trace";
import { handleAdminConsoleMarketGet } from "@/lib/trader/admin-console/handlers/market";
import { handleAdminConsoleNewsGet } from "@/lib/trader/admin-console/handlers/news";
import { handleAdminConsoleAggregateGet } from "@/lib/trader/admin-console/handlers/aggregate";
import { handleAdminConsoleSearchGet } from "@/lib/trader/admin-console/handlers/search";
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
    signal: request.signal,
  });
  if (tool === "get_overview") return handleAdminConsoleOverviewGet(read, deps);
  if (tool === "list_accounts") return handleAdminConsoleAccountsGet(read, deps);
  if (tool === "list_orders") return handleAdminConsoleOrdersGet(read, deps);
  if (tool === "list_clients") return handleAdminConsoleClientsGet(read, deps);
  if (tool === "list_invoices") return handleAdminConsoleInvoicesGet(read, deps);
  if (tool === "strategy_performance")
    return url.searchParams.has("strategy_id")
      ? handleAdminConsoleStrategyDetailGet(read, deps)
      : handleAdminConsoleStrategiesGet(read, deps);
  if (tool === "list_research_runs") return handleAdminConsoleResearchRunsGet(read, deps);
  if (tool === "list_incidents") return handleAdminConsoleIncidentsGet(read, deps);
  if (tool === "list_fills") return handleAdminConsoleFillsGet(read, deps);
  if (tool === "list_positions") return handleAdminConsolePositionsGet(read, deps);
  if (tool === "list_closed_trades") return handleAdminConsoleClosedTradesGet(read, deps);
  if (tool === "list_payments") return handleAdminConsolePaymentsGet(read, deps);
  if (tool === "list_cycles" || tool === "no_trade_reasons")
    return handleAdminConsoleCyclesGet(read, deps);
  if (tool === "market_snapshot") return handleAdminConsoleMarketGet(read, deps);
  if (tool === "list_news") return handleAdminConsoleNewsGet(read, deps);
  if (tool === "search") return handleAdminConsoleSearchGet(read, deps);
  if (tool === "aggregate") return handleAdminConsoleAggregateGet(read, deps);
  const entityId = url.searchParams.get("entity_id");
  if (tool === "get_research_run")
    return entityId
      ? handleAdminConsoleResearchDetailGet(read, deps, [entityId])
      : adminClientError(400, "BAD_REQUEST", "entity_id required.");
  if (tool === "compare_research_runs") {
    const ids = url.searchParams.getAll("run_id");
    return ids.length >= 2
      ? handleAdminConsoleResearchDetailGet(read, deps, ids)
      : adminClientError(400, "BAD_REQUEST", "Choose 2–4 runs.");
  }

  if (
    [
      "get_account",
      "get_invoice",
      "get_order_trace",
      "get_cycle_trace",
      "get_cycle_evidence",
    ].includes(tool) &&
    !entityId
  )
    return adminClientError(400, "BAD_REQUEST", "entity_id required.");
  if (tool === "get_account") return handleAdminConsoleAccountDetailGet(read, deps, entityId!);
  if (tool === "get_invoice") return handleAdminConsoleInvoiceDetailGet(read, deps, entityId!);
  if (tool === "get_order_trace") return handleAdminConsoleOrderDetailGet(read, deps, entityId!);
  if (tool === "get_cycle_trace" || tool === "get_cycle_evidence")
    return handleAdminConsoleCycleTraceGet(read, deps, entityId!);
  if (SYSTEM_TOOLS.has(tool)) return handleAdminConsoleSystemGet(read, deps);
  throw new Error(`Assistant tool is not wired: ${tool}`);
}
