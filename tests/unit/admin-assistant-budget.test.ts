import { describe, expect, it } from "vitest";

import {
  assessAssistantBudget,
  assistantModelDecision,
  resolveAssistantDailyTokenBudget,
  sumUsageTokens,
  tokensFromUsage,
} from "@/lib/trader/admin-console/assistant/budget";
import { runLiveAssistantTurn } from "@/lib/trader/admin-console/assistant/live-turn";
import { UNVERIFIED_SEGMENT } from "@/lib/trader/admin-console/assistant/segments";

describe("admin assistant budget", () => {
  it("prefers the assistant budget and counts every recorded token", () => {
    expect(
      resolveAssistantDailyTokenBudget({
        WAIA_ADMIN_ASSISTANT_DAILY_TOKEN_BUDGET: "20",
        WAIA_AI_TRADER_DAILY_TOKEN_BUDGET: "100",
      }),
    ).toBe(20);
    expect(resolveAssistantDailyTokenBudget({ WAIA_AI_TRADER_DAILY_TOKEN_BUDGET: "100" })).toBe(
      100,
    );
    expect(resolveAssistantDailyTokenBudget({})).toBeNull();
    expect(sumUsageTokens([{ tokens: 4 }, { tokens: 6 }])).toBe(10);
    expect(assessAssistantBudget(10, 10).allowed).toBe(false);
    expect(assessAssistantBudget(9, 10).allowed).toBe(true);
    expect(assessAssistantBudget(10, null).allowed).toBe(true);
  });

  it("estimates usage when the provider omits it and refuses a fake path before the call", () => {
    expect(tokensFromUsage(null, "abcd")).toEqual({ tokens: 1, estimated: true });
    expect(tokensFromUsage({ totalTokens: 0 }, "abcd")).toEqual({ tokens: 0, estimated: false });
    expect(
      assistantModelDecision({ enabled: false, fakePath: false, usedTokens: 0, limit: null }),
    ).toBe("disabled");
    expect(
      assistantModelDecision({ enabled: true, fakePath: false, usedTokens: 5, limit: 5 }),
    ).toBe("budget");
    expect(
      assistantModelDecision({ enabled: true, fakePath: true, usedTokens: 0, limit: null }),
    ).toBe("provider_unavailable");
    expect(
      assistantModelDecision({ enabled: true, fakePath: false, usedTokens: 0, limit: null }),
    ).toBe("call");
  });

  it("refuses unbound numeric text even when the number appears in a tool payload", async () => {
    const kept = await runLiveAssistantTurn({
      content: "сколько",
      toolText: "открыто 12",
      complete: async () => ({
        text: JSON.stringify({ action: "answer", summary: "Открыто 12", citations: [] }),
      }),
    });
    expect(kept.status).toBe("answer");
    if (kept.status !== "answer") return;
    expect(kept.answer.summary).toBe(UNVERIFIED_SEGMENT);
    expect(kept.usage.estimated).toBe(true);

    const dropped = await runLiveAssistantTurn({
      content: "сколько",
      toolText: "нет чисел",
      complete: async () => ({
        text: JSON.stringify({ action: "answer", summary: "Ровно 5", citations: ["missing"] }),
        usage: { totalTokens: 3 },
      }),
    });
    expect(dropped.status).toBe("answer");
    if (dropped.status !== "answer") return;
    expect(dropped.answer.summary).toBe(UNVERIFIED_SEGMENT);
    expect(dropped.answer.citations).toEqual([]);
    expect(dropped.usage).toEqual({ tokens: 3, estimated: false });
  });
});
