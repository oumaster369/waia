import { describe, expect, it, vi } from "vitest";

import type { CompletionProviderPort, CompletionRequest } from "@/lib/ai-gateway/completion-types";
import { TraderReasoningEngine } from "@/lib/ai-gateway/trader-reasoning-engine";

describe("TraderReasoningEngine", () => {
  it("maps completion provider result to reasoning engine completion", async () => {
    const provider: CompletionProviderPort = {
      async complete() {
        return {
          ok: true,
          text: '{"reasoningSummary":"x"}',
          providerRequestId: "req-1",
          finishReason: "stop",
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        };
      },
    };

    const engine = new TraderReasoningEngine();
    const result = await engine.complete(
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        maxOutputTokens: 100,
        temperature: 0,
        outputFormat: "json_object",
      },
      { providerId: "openai-compatible", model: "gpt-4o-mini", provider, maxRetries: 0 },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.providerRequestId).toBe("req-1");
      expect(result.finishReason).toBe("stop");
      expect(result.retryCount).toBe(0);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("retries retryable failures according to maxRetries", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const provider: CompletionProviderPort = {
      async complete(_req: CompletionRequest) {
        calls += 1;
        if (calls === 1) {
          return { ok: false, code: "TIMEOUT", retryable: true };
        }
        return { ok: true, text: "done" };
      },
    };

    const engine = new TraderReasoningEngine();
    const promise = engine.complete(
      {
        model: "m",
        messages: [{ role: "user", content: "hi" }],
        maxOutputTokens: 10,
        temperature: 0,
        outputFormat: "json_object",
      },
      { providerId: "openai-compatible", model: "m", provider, maxRetries: 1 },
    );
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
    if (result.ok) {
      expect(result.retryCount).toBe(1);
    }
  });
});
