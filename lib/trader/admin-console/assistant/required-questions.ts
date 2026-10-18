import { ADMIN_TOOLS } from "@/lib/trader/admin-console/assistant/tools";

export type RequiredQuestion = {
  id: string;
  question: string;
  tools: readonly (typeof ADMIN_TOOLS)[number][];
};

/** Operator questions the read-only assistant must be able to route. */
export const REQUIRED_QUESTIONS: readonly RequiredQuestion[] = [
  { id: "overview", question: "What is on the overview now?", tools: ["get_overview"] },
  { id: "accounts", question: "Which accounts are connected?", tools: ["list_accounts"] },
  { id: "orders", question: "Which orders are still working?", tools: ["list_orders"] },
  {
    id: "clients",
    question: "Which clients are active and which invoices are unpaid?",
    tools: ["list_clients", "list_invoices"],
  },
  { id: "strategies", question: "Which strategies are available?", tools: ["strategy_performance"] },
  { id: "research", question: "How did the latest run finish?", tools: ["list_research_runs"] },
  { id: "no-trade", question: "Why was there no trade?", tools: ["no_trade_reasons"] },
  { id: "incidents", question: "Which errors are open?", tools: ["list_incidents"] },
  {
    id: "system",
    question: "Which release is specified and which jobs were missed?",
    tools: ["system_status", "list_jobs", "release_info"],
  },
];

export function presentRequiredQuestion(
  question: RequiredQuestion,
  input: { scope: string; period: string; currency: "USDT" | "USD" },
): {
  id: string;
  tools: readonly string[];
  scope: string;
  period: string;
  currency: "USDT" | "USD";
  coverage: { complete: false; reason: "ASSISTANT_COVERAGE_FROM_TOOLS" };
  citations: [];
} {
  return {
    id: question.id,
    tools: question.tools,
    scope: input.scope,
    period: input.period,
    currency: input.currency,
    coverage: { complete: false, reason: "ASSISTANT_COVERAGE_FROM_TOOLS" },
    citations: [],
  };
}
