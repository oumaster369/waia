import { ADMIN_TOOLS } from "@/lib/trader/admin-console/assistant/tools";

export type QuickAnswer = {
  id: string;
  title: string;
  tools: readonly (typeof ADMIN_TOOLS)[number][];
  withoutModel: true;
};

export const QUICK_ANSWERS: readonly QuickAnswer[] = [
  { id: "changes", title: "Что изменилось", tools: ["changes_since"], withoutModel: true },
  { id: "overview", title: "Сводка", tools: ["get_overview"], withoutModel: true },
  { id: "accounts", title: "Счета", tools: ["list_accounts"], withoutModel: true },
  { id: "orders", title: "Рабочие ордера", tools: ["list_orders"], withoutModel: true },
  { id: "clients", title: "Клиенты", tools: ["list_clients"], withoutModel: true },
  { id: "invoices", title: "Счета на оплату", tools: ["aggregate"], withoutModel: true },
  { id: "strategies", title: "Стратегии", tools: ["strategy_performance"], withoutModel: true },
  { id: "research", title: "Исследования", tools: ["list_research_runs"], withoutModel: true },
  { id: "no-trade", title: "Почему нет сделки", tools: ["no_trade_reasons"], withoutModel: true },
  { id: "incidents", title: "Инциденты", tools: ["list_incidents"], withoutModel: true },
  {
    id: "system",
    title: "Система и релиз",
    tools: ["system_status", "list_jobs", "release_info"],
    withoutModel: true,
  },
];

export function findQuickAnswer(id: string): QuickAnswer | null {
  return QUICK_ANSWERS.find((item) => item.id === id) ?? null;
}
