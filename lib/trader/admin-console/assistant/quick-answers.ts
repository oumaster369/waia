import { ADMIN_TOOLS } from "@/lib/trader/admin-console/assistant/tools";

export type QuickAnswer = {
  id: string;
  title: string;
  tools: readonly (typeof ADMIN_TOOLS)[number][];
  withoutModel: true;
};

export const QUICK_ANSWERS: readonly QuickAnswer[] = [
  { id: "changes", title: "What changed", tools: ["changes_since"], withoutModel: true },
  { id: "overview", title: "Summary", tools: ["get_overview"], withoutModel: true },
  { id: "accounts", title: "Accounts", tools: ["list_accounts"], withoutModel: true },
  { id: "orders", title: "Working orders", tools: ["list_orders"], withoutModel: true },
  { id: "clients", title: "Clients", tools: ["list_clients"], withoutModel: true },
  { id: "invoices", title: "Invoices", tools: ["aggregate"], withoutModel: true },
  { id: "strategies", title: "Strategies", tools: ["strategy_performance"], withoutModel: true },
  { id: "research", title: "Research", tools: ["list_research_runs"], withoutModel: true },
  { id: "no-trade", title: "Why no trade", tools: ["no_trade_reasons"], withoutModel: true },
  { id: "incidents", title: "Incidents", tools: ["list_incidents"], withoutModel: true },
  {
    id: "system",
    title: "System and release",
    tools: ["system_status", "list_jobs", "release_info"],
    withoutModel: true,
  },
];

export function findQuickAnswer(id: string): QuickAnswer | null {
  return QUICK_ANSWERS.find((item) => item.id === id) ?? null;
}
