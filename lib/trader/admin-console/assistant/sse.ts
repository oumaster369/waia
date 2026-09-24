export type AssistantSseEvent =
  | { event: "stage"; data: { tool: string; stage: string } }
  | { event: "tool_result_ready"; data: { tool: string } }
  | { event: "answer"; data: { status: string; content: string } }
  | { event: "error"; data: { reason: string } };

const STAGE_LABELS: Record<string, string> = {
  get_overview: "Собираю сводку…",
  list_accounts: "Получаю счета…",
  list_orders: "Читаю ордера…",
  list_clients: "Читаю клиентов…",
  list_invoices: "Проверяю платежи…",
  strategy_performance: "Считаю стратегии…",
  list_research_runs: "Сравниваю запуски…",
  list_incidents: "Читаю инциденты…",
  system_status: "Проверяю систему…",
};

export function assistantStageLabel(tool: string): string {
  return STAGE_LABELS[tool] ?? "Читаю данные…";
}

export function assistantToolEvents(tools: readonly string[]): AssistantSseEvent[] {
  return tools.flatMap((tool) => [
    { event: "stage" as const, data: { tool, stage: assistantStageLabel(tool) } },
    { event: "tool_result_ready" as const, data: { tool } },
  ]);
}

export function encodeAssistantSse(events: readonly AssistantSseEvent[]): Uint8Array {
  const text = events
    .map((item) => `event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`)
    .join("");
  return new TextEncoder().encode(text);
}

export function wantsAssistantSse(request: Request): boolean {
  return request.headers.get("accept")?.includes("text/event-stream") === true;
}
