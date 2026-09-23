import { describe, expect, it } from "vitest";

import { UNVERIFIED_SEGMENT } from "@/lib/trader/admin-console/assistant/segments";
import { runAssistantTurn } from "@/lib/trader/admin-console/assistant/run-assistant";

describe("admin assistant loop", () => {
  it("retries invalid JSON once and then fails", async () => {
    let calls = 0;
    const result = await runAssistantTurn({
      complete: async () => {
        calls += 1;
        return "not-json";
      },
      knownCitations: [],
      factRefs: [],
    });
    expect(calls).toBe(2);
    expect(result).toEqual({ status: "failed", message: "Не удалось разобрать ответ модели" });
  });

  it("drops a citation that was not in the tool results and removes an unproven fact", async () => {
    const result = await runAssistantTurn({
      complete: async () =>
        JSON.stringify({
          action: "answer",
          summary: "Комиссия 30",
          citations: ["invoice:1", "invoice:missing"],
        }),
      knownCitations: ["invoice:1"],
      factRefs: [{ value: "10" }],
    });
    expect(result.status).toBe("answer");
    if (result.status === "answer") {
      expect(result.answer.citations).toEqual(["invoice:1"]);
      expect(result.answer.summary).toBe(UNVERIFIED_SEGMENT);
    }
  });

  it("stops when the provider aborts", async () => {
    const result = await runAssistantTurn({
      complete: async () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      },
      knownCitations: [],
      factRefs: [],
    });
    expect(result).toEqual({ status: "stopped" });
  });
});
