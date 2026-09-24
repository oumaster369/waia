export const ADMIN_TOOL_POLICY = "admin-tools/v1" as const;
export const ASSISTANT_PROMPT_VERSION = "admin-assistant/v1" as const;

export const ADMIN_TOOLS = [
  "get_overview",
  "list_accounts",
  "get_account",
  "list_clients",
  "get_client",
  "list_invoices",
  "get_invoice",
  "list_payments",
  "list_orders",
  "get_order_trace",
  "list_fills",
  "list_positions",
  "list_closed_trades",
  "strategy_performance",
  "list_research_runs",
  "get_research_run",
  "compare_research_runs",
  "list_cycles",
  "get_cycle_trace",
  "get_cycle_evidence",
  "no_trade_reasons",
  "market_snapshot",
  "list_news",
  "list_incidents",
  "get_incident",
  "system_status",
  "list_jobs",
  "release_info",
  "changes_since",
  "search",
  "aggregate",
] as const;

export const TOOL_ROW_LIMIT = 50;

export function limitToolRows<T>(rows: readonly T[]): {
  data: T[];
  total: number;
  truncated: boolean;
} {
  return {
    data: rows.slice(0, TOOL_ROW_LIMIT),
    total: rows.length,
    truncated: rows.length > TOOL_ROW_LIMIT,
  };
}

export function holdoutRead(): { state: "unavailable"; reason: "HOLDOUT_PROTECTED" } {
  return { state: "unavailable", reason: "HOLDOUT_PROTECTED" };
}
