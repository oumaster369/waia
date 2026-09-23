import { ADMIN_TOOLS } from "@/lib/trader/admin-console/assistant/tools";

export type RequiredQuestion = {
  id: string;
  question: string;
  tools: readonly (typeof ADMIN_TOOLS)[number][];
};

/** Operator questions the read-only assistant must be able to route. */
export const REQUIRED_QUESTIONS: readonly RequiredQuestion[] = [
  { id: "overview", question: "Что сейчас на обзоре?", tools: ["get_overview"] },
  { id: "accounts", question: "Какие счета подключены?", tools: ["list_accounts"] },
  { id: "orders", question: "Какие ордера ещё работают?", tools: ["list_orders"] },
  {
    id: "clients",
    question: "Кто из клиентов активен и какие счета не оплачены?",
    tools: ["list_clients", "list_invoices"],
  },
  { id: "strategies", question: "Какие стратегии есть?", tools: ["strategy_performance"] },
  { id: "research", question: "Чем закончился последний запуск?", tools: ["list_research_runs"] },
  { id: "no-trade", question: "Почему не было сделки?", tools: ["no_trade_reasons"] },
  { id: "incidents", question: "Какие ошибки открыты?", tools: ["list_incidents"] },
  {
    id: "system",
    question: "Какой релиз указан и какие задания пропущены?",
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
