import "server-only";

import type {
  CompletionProviderPort,
  CompletionRequest,
  CompletionResult,
} from "@/lib/ai-gateway/completion-types";

export type RetryPolicyConfig = {
  maxRetries: number;
};

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

function isRetryableResult(result: CompletionResult): boolean {
  return !result.ok && result.retryable;
}

export function wrapCompletionProviderWithRetry(
  inner: CompletionProviderPort,
  policy: RetryPolicyConfig,
): CompletionProviderPort {
  return {
    async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
      let lastResult: CompletionResult = {
        ok: false,
        code: "PROVIDER_ERROR",
        retryable: false,
      };
      const maxAttempts = policy.maxRetries + 1;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        lastResult = await inner.complete(req, signal);
        if (!isRetryableResult(lastResult) || attempt >= policy.maxRetries) {
          return lastResult;
        }
        await sleep(computeBackoffMs(attempt));
      }
      return lastResult;
    },
  };
}

type TokenBudgetState = {
  dayKey: string;
  tokensUsed: number;
};

let tokenBudgetState: TokenBudgetState = { dayKey: "", tokensUsed: 0 };

function currentUtcDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function resetTraderTokenBudgetForTests(): void {
  tokenBudgetState = { dayKey: "", tokensUsed: 0 };
}

export function wrapCompletionProviderWithTokenBudget(
  inner: CompletionProviderPort,
  dailyTokenBudget: number | undefined,
): CompletionProviderPort {
  if (dailyTokenBudget === undefined || dailyTokenBudget <= 0) {
    return inner;
  }
  return {
    async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
      const dayKey = currentUtcDayKey();
      if (tokenBudgetState.dayKey !== dayKey) {
        tokenBudgetState = { dayKey, tokensUsed: 0 };
      }
      if (tokenBudgetState.tokensUsed >= dailyTokenBudget) {
        return { ok: false, code: "CONFIG", retryable: false };
      }
      const result = await inner.complete(req, signal);
      if (result.ok && result.usage?.totalTokens !== undefined) {
        tokenBudgetState.tokensUsed += result.usage.totalTokens;
      }
      return result;
    },
  };
}

type RpmWindow = {
  windowStartMs: number;
  count: number;
};

let rpmWindow: RpmWindow = { windowStartMs: 0, count: 0 };

export function resetTraderRpmGateForTests(): void {
  rpmWindow = { windowStartMs: 0, count: 0 };
}

export function wrapCompletionProviderWithRpmGate(
  inner: CompletionProviderPort,
  rateLimitRpm: number | undefined,
): CompletionProviderPort {
  if (rateLimitRpm === undefined || rateLimitRpm <= 0) {
    return inner;
  }
  return {
    async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
      const now = Date.now();
      if (now - rpmWindow.windowStartMs >= 60_000) {
        rpmWindow = { windowStartMs: now, count: 0 };
      }
      if (rpmWindow.count >= rateLimitRpm) {
        return { ok: false, code: "RATE_LIMIT", retryable: false };
      }
      rpmWindow.count += 1;
      return inner.complete(req, signal);
    },
  };
}

export function buildPolicyWrappedCompletionProvider(
  inner: CompletionProviderPort,
  options: {
    dailyTokenBudget?: number;
    rateLimitRpm?: number;
  },
): CompletionProviderPort {
  let provider = inner;
  provider = wrapCompletionProviderWithRpmGate(provider, options.rateLimitRpm);
  provider = wrapCompletionProviderWithTokenBudget(provider, options.dailyTokenBudget);
  return provider;
}
