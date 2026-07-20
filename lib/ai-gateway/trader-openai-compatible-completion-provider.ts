import "server-only";

import type {
  CompletionProviderPort,
  CompletionRequest,
  CompletionResult,
} from "@/lib/ai-gateway/completion-types";
import {
  DEFAULT_OPENAI_MODEL,
  executeOpenAiCompatibleChatCompletion,
  isOpenAiParseDiagnosticsEnabled,
  normalizeOpenAiBaseUrl,
  resolveOpenAiReasoningMinCompletionTokensFromEnv,
  resolveOpenAiTimeoutMsFromEnv,
} from "@/lib/ai-gateway/openai-compatible-completion-core";

export const TRADER_OPENAI_ADAPTER_VERSION = "waia-trader-openai-adapter@1" as const;

function resolveTraderRuntimeConfig() {
  return {
    apiKey: process.env.WAIA_AI_TRADER_OPENAI_API_KEY?.trim(),
    baseUrl: normalizeOpenAiBaseUrl(process.env.WAIA_AI_TRADER_OPENAI_BASE_URL),
    timeoutMs: resolveOpenAiTimeoutMsFromEnv(process.env.WAIA_AI_TRADER_OPENAI_REQUEST_TIMEOUT_MS),
    reasoningMinCompletionTokens: resolveOpenAiReasoningMinCompletionTokensFromEnv(undefined),
    parseDiagnostics: isOpenAiParseDiagnosticsEnabled(
      process.env.WAIA_AI_TRADER_OPENAI_PARSE_DIAGNOSTICS,
    ),
  };
}

/** AI-TRADER external provider — reads WAIA_AI_TRADER_OPENAI_* only (never Twin keys). */
export class TraderOpenAiCompatibleCompletionProvider implements CompletionProviderPort {
  async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    return executeOpenAiCompatibleChatCompletion(resolveTraderRuntimeConfig(), req, signal);
  }
}

export function resolveTraderOpenAiDefaultModel(): string {
  const raw = process.env.WAIA_AI_TRADER_OPENAI_MODEL?.trim();
  return raw !== undefined && raw !== "" ? raw : DEFAULT_OPENAI_MODEL;
}

export function resolveTraderOpenAiTemperature(): number {
  const raw = process.env.WAIA_AI_TRADER_OPENAI_TEMPERATURE?.trim();
  if (raw === undefined || raw === "") {
    return 0;
  }
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(2, Math.max(0, n));
}

export function resolveTraderOpenAiMaxOutputTokens(): number {
  const raw = process.env.WAIA_AI_TRADER_OPENAI_MAX_OUTPUT_TOKENS?.trim();
  if (raw === undefined || raw === "") {
    return 2048;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    return 2048;
  }
  return n;
}

export function resolveTraderOpenAiMaxRetries(): number {
  const raw = process.env.WAIA_AI_TRADER_OPENAI_MAX_RETRIES?.trim();
  if (raw === undefined || raw === "") {
    return 2;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    return 2;
  }
  return n;
}
