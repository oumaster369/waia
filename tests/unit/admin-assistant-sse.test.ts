import { describe, expect, it } from "vitest";

import {
  assistantStageLabel,
  assistantToolEvents,
  encodeAssistantSse,
} from "@/lib/trader/admin-console/assistant/sse";

describe("admin assistant stream", () => {
  it("names the brief stages and writes them before the tool result", () => {
    expect(assistantStageLabel("list_accounts")).toBe("Получаю счета…");
    expect(assistantStageLabel("list_invoices")).toBe("Проверяю платежи…");
    expect(assistantStageLabel("list_research_runs")).toBe("Сравниваю запуски…");
    const encoded = new TextDecoder().decode(
      encodeAssistantSse([
        ...assistantToolEvents(["list_accounts"]),
        { event: "answer", data: { status: "complete", content: "Готово" } },
        { event: "error", data: { reason: "ASSISTANT_DISABLED" } },
      ]),
    );
    const stageAt = encoded.indexOf("event: stage");
    const readyAt = encoded.indexOf("event: tool_result_ready");
    const answerAt = encoded.indexOf("event: answer");
    expect(stageAt).toBeGreaterThanOrEqual(0);
    expect(stageAt).toBeLessThan(readyAt);
    expect(readyAt).toBeLessThan(answerAt);
    expect(encoded).toContain("Получаю счета…");
    expect(encoded).toContain("ASSISTANT_DISABLED");
  });
});
