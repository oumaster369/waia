/**
 * Tables each admin-console handler actually reads or writes.
 * The schema probe uses this list and nothing else.
 */

export const TABLES_FROM_0212 = [
  "trader_human_promotion_proposal_v2",
  "trader_human_research_assignment_v2",
] as const;

export const TABLES_FROM_0214 = [
  "trader_admin_market_quote_latest",
  "trader_admin_market_quote_minute",
  "trader_admin_fear_greed",
  "trader_admin_change_log",
  "trader_admin_news_item",
  "trader_admin_news_item_version",
  "trader_admin_account_valuation",
  "trader_admin_equity_point",
  "trader_admin_diagnostic_event",
  "trader_admin_incident",
  "trader_admin_incident_event",
  "trader_admin_job_run",
  "trader_admin_assistant_conversation",
  "trader_admin_assistant_message",
  "trader_admin_assistant_tool_call",
  "trader_admin_saved_view",
  "trader_admin_visit_marker",
] as const;

const from0212 = new Set<string>(TABLES_FROM_0212);
const from0214 = new Set<string>(TABLES_FROM_0214);

export type ConsoleSchemaGate = "ready-on-0210" | "waits-0212" | "waits-0214";

export function consoleSchemaGate(tables: readonly string[]): ConsoleSchemaGate {
  if (tables.some((table) => from0214.has(table))) return "waits-0214";
  if (tables.some((table) => from0212.has(table))) return "waits-0212";
  return "ready-on-0210";
}

/** Tables collectors and retention write. Missing any of them skips the cycle. */
export const COLLECTOR_SCHEMA_TABLES = [
  "trader_admin_market_quote_latest",
  "trader_admin_market_quote_minute",
  "trader_admin_fear_greed",
  "trader_admin_news_item",
  "trader_admin_news_item_version",
  "trader_admin_job_run",
  "trader_admin_change_log",
  "trader_admin_account_valuation",
  "trader_admin_equity_point",
  "trader_admin_diagnostic_event",
] as const;

export const HANDLER_TABLES = {
  accounts: ["exchange_credentials"],
  attention: [
    "trader_orders",
    "trader_execution_reports_v2",
    "trader_runtime_authority_assessments_v2",
    "trader_risk_account_state_v2",
    "trader_position_lots",
    "trader_guardian_assessments_v2",
    "trader_settlement_reconciliation_cases",
    "trader_trade_legs",
    "trader_account_collection_state",
    "trader_account_observations",
    "exchange_credentials",
    "trader_admin_job_run",
    "trader_admin_incident",
    "trader_invoices",
    "trader_settlements",
    "trader_reporting_periods",
    "trader_human_promotion_proposal_v2",
  ],
  assistantConversations: ["trader_admin_assistant_conversation"],
  assistantMessages: [
    "trader_admin_assistant_conversation",
    "trader_admin_assistant_message",
    "trader_admin_assistant_tool_call",
  ],
  assistantTrace: ["trader_admin_assistant_message", "trader_admin_assistant_tool_call"],
  clients: [
    "organizations",
    "users",
    "organization_entitlements",
    "trader_invoices",
    "exchange_credentials",
    "trader_position_lots",
    "trader_account_observations",
  ],
  closedTrades: ["trader_trades"],
  cycleTrace: [
    "trader_intelligence_cycle_envelope",
    "trader_intelligence_hypothesis_record",
    "trader_intelligence_forecast_record",
    "trader_intelligence_decision_record",
    "trader_risk_verdicts_v2",
    "trader_execution_plans_v2",
    "trader_fills",
    "trader_orders",
  ],
  disputes: ["trader_invoice_disputes"],
  exportInvoices: ["trader_invoices"],
  fills: ["trader_fills", "trader_orders"],
  incidents: ["trader_admin_incident"],
  invoices: [
    "trader_invoices",
    "trader_invoice_disputes",
    "trader_invoice_corrections",
    "trader_settlement_applications",
    "trader_settlements",
    "trader_settlement_reconciliation_cases",
    "payment_events",
    "trader_hwm_ledger",
  ],
  orders: ["trader_orders"],
  overview: [
    "exchange_credentials",
    "organizations",
    "users",
    "trader_admin_market_quote_latest",
    "trader_position_lots",
    "trader_trade_legs",
    "trader_orders",
    "trader_account_collection_state",
    "trader_account_observations",
  ],
  payments: ["payment_events"],
  positions: [
    "trader_position_lots",
    "trader_guardian_assessments_v2",
    "trader_risk_account_state_v2",
    "trader_trade_legs",
    "trader_orders",
    "exchange_credentials",
  ],
  proposals: ["trader_human_promotion_proposal_v2"],
  reportingPeriods: ["trader_reporting_periods"],
  researchRuns: ["trader_historical_simulation_run_lifecycle_event_v2"],
  savedViews: ["trader_admin_saved_view"],
  search: [
    "organizations",
    "users",
    "exchange_credentials",
    "trader_invoices",
    "payment_events",
    "trader_orders",
    "trader_strategy_promotion_records",
    "trader_backtest_runs",
    "trader_admin_incident",
  ],
  strategies: ["trader_trades"],
  system: ["trader_admin_job_run"],
  visitMarker: ["trader_admin_visit_marker"],
  stream: ["trader_admin_change_log", "exchange_credentials"],
} as const;
