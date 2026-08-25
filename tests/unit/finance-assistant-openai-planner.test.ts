import { afterEach, describe, expect, it, vi } from "vitest";

import { FINANCE_ASSISTANT_FIELD_NAMES } from "@/lib/waia-core/finance-assistant/planner";
import { planFinanceRequest } from "@/lib/waia-core/finance-assistant/openai-planner";

function fields(): Record<string, null> {
  return Object.fromEntries(FINANCE_ASSISTANT_FIELD_NAMES.map((field) => [field, null]));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Finance Assistant OpenAI boundary", () => {
  it("uses only the official Responses endpoint and a strict forced tool", async () => {
    vi.stubEnv("WAIA_FINANCE_ASSISTANT_OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "resp_test",
            output: [
              {
                type: "function_call",
                name: "plan_finance_request",
                arguments: JSON.stringify({
                  intent: "REPORT_OVERVIEW",
                  summary: "Current overview",
                  fields: fields(),
                }),
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const plan = await planFinanceRequest("Show the current overview");

    expect(plan.intent).toBe("REPORT_OVERVIEW");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const [url, init] = calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    const request = JSON.parse(String(init?.body)) as {
      parallel_tool_calls: boolean;
      tool_choice: { name: string };
      tools: Array<{ strict: boolean; parameters: { additionalProperties: boolean } }>;
    };
    expect(request.parallel_tool_calls).toBe(false);
    expect(request.tool_choice.name).toBe("plan_finance_request");
    expect(request.tools[0]?.strict).toBe(true);
    expect(request.tools[0]?.parameters.additionalProperties).toBe(false);
  });

  it("rejects malformed or oversized provider responses", async () => {
    vi.stubEnv("WAIA_FINANCE_ASSISTANT_OPENAI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not-json", { status: 200 })),
    );
    await expect(planFinanceRequest("Show the budget")).rejects.toMatchObject({
      code: "INVALID_MODEL_OUTPUT",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x".repeat(100_001), { status: 200 })),
    );
    await expect(planFinanceRequest("Show the budget")).rejects.toMatchObject({
      code: "INVALID_MODEL_OUTPUT",
    });
  });
});
