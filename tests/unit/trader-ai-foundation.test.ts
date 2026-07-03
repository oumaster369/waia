import { afterEach, describe, expect, it, vi } from "vitest";

import type { CompletionProviderPort, CompletionRequest } from "@/lib/ai-gateway/completion-types";
import {
  buildPolicyWrappedCompletionProvider,
  resetTraderRpmGateForTests,
  resetTraderTokenBudgetForTests,
  wrapCompletionProviderWithRetry,
} from "@/lib/ai-gateway/trader-foundation-policies";
import {
  isWaiaAiTraderGatewayFoundationEnabled,
  isWaiaTraderSeeAiReasoningEnabled,
  resolveProviderLifecycleState,
  resolveTraderAIFoundation,
  resolveWaiaAiTraderProviderId,
} from "@/lib/ai-gateway/trader-foundation-profile";
import { TraderOpenAiCompatibleCompletionProvider } from "@/lib/ai-gateway/trader-openai-compatible-completion-provider";

describe("trader AI foundation (SEE-R2)", () => {
  const envKeys = [
    "WAIA_AI_TRADER_GATEWAY_FOUNDATION",
    "WAIA_TRADER_SEE_AI_REASONING",
    "WAIA_AI_TRADER_PROVIDER",
    "WAIA_AI_TRADER_OPENAI_API_KEY",
    "WAIA_AI_TRADER_PROVIDER_LIFECYCLE",
  ] as const;

  const prev: Record<string, string | undefined> = {};

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of envKeys) {
      if (prev[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prev[key];
      }
    }
    resetTraderRpmGateForTests();
    resetTraderTokenBudgetForTests();
  });

  function snapshotEnv(): void {
    for (const key of envKeys) {
      prev[key] = process.env[key];
    }
  }

  it("defaults to fake lifecycle when gates are off", () => {
    snapshotEnv();
    delete process.env.WAIA_AI_TRADER_GATEWAY_FOUNDATION;
    delete process.env.WAIA_TRADER_SEE_AI_REASONING;
    const profile = resolveTraderAIFoundation();
    expect(profile.lifecycle).toBe("fake");
    expect(profile.providerId).toBe("fake");
  });

  it("resolves openai-compatible when fully configured", () => {
    snapshotEnv();
    process.env.WAIA_AI_TRADER_GATEWAY_FOUNDATION = "1";
    process.env.WAIA_TRADER_SEE_AI_REASONING = "1";
    process.env.WAIA_AI_TRADER_PROVIDER = "openai-compatible";
    process.env.WAIA_AI_TRADER_OPENAI_API_KEY = "trader-test-key";
    process.env.WAIA_AI_TRADER_PROVIDER_LIFECYCLE = "sandbox";
    expect(isWaiaAiTraderGatewayFoundationEnabled()).toBe(true);
    expect(isWaiaTraderSeeAiReasoningEnabled()).toBe(true);
    expect(resolveWaiaAiTraderProviderId()).toBe("openai-compatible");
    expect(resolveProviderLifecycleState(true)).toBe("sandbox");
    const profile = resolveTraderAIFoundation();
    expect(profile.providerId).toBe("openai-compatible");
    expect(profile.providerClass).toBe("external");
    expect(profile.reasoningEngine).toBeDefined();
    expect(profile.executionContext.maxRetries).toBeGreaterThan(0);
  });
});

describe("trader foundation policies", () => {
  it("retries retryable provider failures", async () => {
    let calls = 0;
    const inner: CompletionProviderPort = {
      async complete(_req: CompletionRequest) {
        calls += 1;
        if (calls === 1) {
          return { ok: false, code: "RATE_LIMIT", retryable: true };
        }
        return {
          ok: true,
          text: "ok",
        };
      },
    };
    const wrapped = wrapCompletionProviderWithRetry(inner, { maxRetries: 2 });
    const result = await wrapped.complete({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      maxOutputTokens: 10,
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("enforces token budget", async () => {
    resetTraderTokenBudgetForTests();
    const inner: CompletionProviderPort = {
      async complete() {
        return {
          ok: true,
          text: "ok",
          usage: { totalTokens: 100 },
        };
      },
    };
    const wrapped = buildPolicyWrappedCompletionProvider(inner, { dailyTokenBudget: 50 });
    const first = await wrapped.complete({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      maxOutputTokens: 10,
    });
    expect(first.ok).toBe(true);
    const second = await wrapped.complete({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      maxOutputTokens: 10,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe("CONFIG");
    }
  });
});

describe("TraderOpenAiCompatibleCompletionProvider", () => {
  const prevKey = process.env.WAIA_AI_TRADER_OPENAI_API_KEY;

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) {
      delete process.env.WAIA_AI_TRADER_OPENAI_API_KEY;
    } else {
      process.env.WAIA_AI_TRADER_OPENAI_API_KEY = prevKey;
    }
  });

  it("returns CONFIG when trader API key missing", async () => {
    delete process.env.WAIA_AI_TRADER_OPENAI_API_KEY;
    const provider = new TraderOpenAiCompatibleCompletionProvider();
    const result = await provider.complete({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
      maxOutputTokens: 10,
      responseFormat: "json_object",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CONFIG");
    }
  });

  it("never reads WAIA_AI_OPENAI_API_KEY", async () => {
    process.env.WAIA_AI_OPENAI_API_KEY = "twin-key";
    delete process.env.WAIA_AI_TRADER_OPENAI_API_KEY;
    const provider = new TraderOpenAiCompatibleCompletionProvider();
    const result = await provider.complete({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
      maxOutputTokens: 10,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CONFIG");
    }
  });

  it("sends json_object response_format when configured", async () => {
    process.env.WAIA_AI_TRADER_OPENAI_API_KEY = "trader-key";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl-trader-1",
          choices: [
            {
              finish_reason: "stop",
              message: { role: "assistant", content: '{"ok":true}' },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = new TraderOpenAiCompatibleCompletionProvider();
    const result = await provider.complete({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
      maxOutputTokens: 10,
      responseFormat: "json_object",
    });

    expect(result.ok).toBe(true);
    const init = fetchSpy.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as { response_format?: { type: string } };
    expect(body.response_format).toEqual({ type: "json_object" });
  });
});
