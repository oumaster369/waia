import { describe, expect, it } from "vitest";

import {
  FINANCE_ASSISTANT_FIELD_NAMES,
  parseFinanceAssistantPlan,
  requireSafeFinanceAssistantMessage,
} from "@/lib/waia-core/finance-assistant/planner";

function emptyFields(): Record<string, null> {
  return Object.fromEntries(FINANCE_ASSISTANT_FIELD_NAMES.map((field) => [field, null]));
}

describe("Finance Assistant typed planner boundary", () => {
  it("accepts one closed intent with the exact field set", () => {
    const plan = parseFinanceAssistantPlan(
      {
        intent: "REPORT_BUDGET",
        summary: "Current budget report",
        language: "en",
        question: null,
        fields: emptyFields(),
      },
      { model: "test-model", requestId: "request-1" },
    );
    expect(plan.intent).toBe("REPORT_BUDGET");
    expect(plan.providerRequestId).toBe("request-1");
  });

  it("rejects unknown intents and fields", () => {
    expect(() =>
      parseFinanceAssistantPlan(
        {
          intent: "RUN_SQL",
          summary: "No",
          language: "en",
          question: null,
          fields: emptyFields(),
        },
        { model: "test" },
      ),
    ).toThrow(/intent/i);
    expect(() =>
      parseFinanceAssistantPlan(
        {
          intent: "REPORT_OVERVIEW",
          summary: "No",
          language: "en",
          question: null,
          fields: { ...emptyFields(), sql: "drop table" },
        },
        { model: "test" },
      ),
    ).toThrow(/unknown field/i);
  });

  it("preserves Russian language and a precise follow-up", () => {
    const plan = parseFinanceAssistantPlan(
      {
        intent: "CREATE_TRANSACTION",
        summary: "Подготовлю расход.",
        language: "ru",
        question: "С какого счета списать средства?",
        fields: { ...emptyFields(), signedAmount: "-25" },
      },
      { model: "test" },
    );
    expect(plan.language).toBe("ru");
    expect(plan.question).toMatch(/счета/i);
  });

  it("rejects secrets and card-shaped values before provider egress", () => {
    expect(() => requireSafeFinanceAssistantMessage("Store my seed phrase here")).toThrow(
      /do not enter/i,
    );
    expect(() => requireSafeFinanceAssistantMessage("Card 4111 1111 1111 1111")).toThrow(
      /do not enter/i,
    );
    expect(requireSafeFinanceAssistantMessage("Show the current budget")).toBe(
      "Show the current budget",
    );
  });
});
