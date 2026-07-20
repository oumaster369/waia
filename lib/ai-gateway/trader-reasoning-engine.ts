import "server-only";

import type { CompletionRequest } from "@/lib/ai-gateway/completion-types";
import type {
  ReasoningEngineCompletion,
  ReasoningEnginePort,
  ReasoningExecutionContext,
  ReasoningRequestSpec,
} from "@/lib/trader/research/reasoning-engine.types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function computeBackoffMs(attempt: number): number {
  const base = Math.min(8000, 500 * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 251);
  return base + jitter;
}

export class TraderReasoningEngine implements ReasoningEnginePort {
  async complete(
    spec: ReasoningRequestSpec,
    ctx: ReasoningExecutionContext,
    signal?: AbortSignal,
  ): Promise<ReasoningEngineCompletion> {
    const started = Date.now();
    const req: CompletionRequest = {
      model: spec.model,
      messages: spec.messages,
      maxOutputTokens: spec.maxOutputTokens,
      temperature: spec.temperature,
      responseFormat: spec.outputFormat === "json_object" ? "json_object" : undefined,
    };

    let retryCount = 0;
    const maxAttempts = ctx.maxRetries + 1;
    let lastResult: import("@/lib/ai-gateway/completion-types").CompletionResult = {
      ok: false,
      code: "PROVIDER_ERROR",
      retryable: false,
    };

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      lastResult = await ctx.provider.complete(req, signal);
      if (lastResult.ok || !lastResult.retryable || attempt >= ctx.maxRetries) {
        break;
      }
      retryCount += 1;
      await sleep(computeBackoffMs(attempt));
    }

    const latencyMs = Date.now() - started;

    if (!lastResult.ok) {
      const code =
        lastResult.code === "CONFIG" && retryCount === 0
          ? lastResult.code
          : lastResult.code === "RATE_LIMIT"
            ? "RATE_LIMIT"
            : lastResult.code === "TIMEOUT"
              ? "TIMEOUT"
              : lastResult.code === "CONFIG"
                ? "BUDGET_EXCEEDED"
                : "PROVIDER_ERROR";
      return {
        ok: false,
        code,
        retryable: lastResult.retryable,
        latencyMs,
        retryCount,
      };
    }

    return {
      ok: true,
      text: lastResult.text,
      usage: lastResult.usage,
      providerRequestId: lastResult.providerRequestId,
      finishReason: lastResult.finishReason,
      latencyMs,
      retryCount,
    };
  }
}

export const traderReasoningEngine = new TraderReasoningEngine();
