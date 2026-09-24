import { ADMIN_TOOLS } from "@/lib/trader/admin-console/assistant/tools";

export type AssistantHelpEntry = {
  tool: (typeof ADMIN_TOOLS)[number];
  title: string;
  description: string;
  example: string;
};

/** Tools whose read function is the same one the console route calls. */
export const ASSISTANT_HELP: readonly AssistantHelpEntry[] = [
  {
    tool: "get_overview",
    title: "Сводка",
    description: "Капитал, покрытие и причины, почему цифра неполная.",
    example: "Что сейчас на обзоре?",
  },
  {
    tool: "list_accounts",
    title: "Счета",
    description: "Подключённые счета. Секреты ключей не читаются.",
    example: "Какие счета подключены?",
  },
  {
    tool: "list_clients",
    title: "Клиенты",
    description: "Организации с доступом к модулю и их статус.",
    example: "Кто из клиентов активен?",
  },
  {
    tool: "list_invoices",
    title: "Счета на оплату",
    description: "Статусы счетов. Консоль сама счёт не выставляет.",
    example: "Какие счета не оплачены?",
  },
  {
    tool: "list_orders",
    title: "Ордера",
    description: "Рабочие ордера.",
    example: "Какие ордера ещё работают?",
  },
  {
    tool: "strategy_performance",
    title: "Стратегии",
    description: "Каталог и статистика. Доходность в процентах не считается.",
    example: "Какие стратегии есть?",
  },
  {
    tool: "list_research_runs",
    title: "Исследования",
    description: "Состояние запусков. Закрытая выборка недоступна.",
    example: "Чем закончился последний запуск?",
  },
  {
    tool: "list_incidents",
    title: "Инциденты",
    description: "Ошибки консоли без текста стека.",
    example: "Какие ошибки открыты?",
  },
  {
    tool: "system_status",
    title: "Система",
    description: "Релиз не подтверждён, задания и пропущенные минуты.",
    example: "Что с релизом и заданиями?",
  },
  {
    tool: "list_jobs",
    title: "Задания",
    description: "Каталог заданий и последние запуски.",
    example: "Какие задания пропускали минуту?",
  },
  {
    tool: "release_info",
    title: "Релиз",
    description: "Известен только SHA из переменной. Совпадение с деплоем не подтверждено.",
    example: "Какой релиз сейчас указан?",
  },
  {
    tool: "search",
    title: "Поиск",
    description: "Поиск по клиентам, счетам, ордерам и счетам на оплату.",
    example: "Найди счёт по имени.",
  },
];

export function assistantHelpEntries(): readonly AssistantHelpEntry[] {
  return ASSISTANT_HELP.filter((entry) => ADMIN_TOOLS.includes(entry.tool));
}
