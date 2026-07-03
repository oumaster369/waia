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
  resolveEffectiveMaxCompletionTokens as coreResolveEffectiveMaxCompletionTokens,
  resolveOpenAiReasoningMinCompletionTokensFromEnv,
  resolveOpenAiTimeoutMsFromEnv,
} from "@/lib/ai-gateway/openai-compatible-completion-core";

export {
  DEFAULT_OPENAI_MODEL,
  isOpenAiReasoningChatModelId,
  summarizeOpenAiAssistantParseFailure,
  summarizeOpenAiHttpErrorBody,
  WAIA_AI_MAX_ASSISTANT_OUTPUT_CHARS,
  resolveOpenAiReasoningMinCompletionTokensFromEnv,
} from "@/lib/ai-gateway/openai-compatible-completion-core";

export function resolveEffectiveMaxCompletionTokens(
  model: string,
  maxOutputTokens: number,
): number {
  return coreResolveEffectiveMaxCompletionTokens(
    model,
    maxOutputTokens,
    resolveOpenAiReasoningMinCompletionTokensFromEnv(
      process.env.WAIA_AI_OPENAI_REASONING_MIN_COMPLETION_TOKENS,
    ),
  );
}

function resolveTwinRuntimeConfig() {
  return {
    apiKey: process.env.WAIA_AI_OPENAI_API_KEY?.trim(),
    baseUrl: normalizeOpenAiBaseUrl(process.env.WAIA_AI_OPENAI_BASE_URL),
    timeoutMs: resolveOpenAiTimeoutMsFromEnv(process.env.WAIA_AI_OPENAI_REQUEST_TIMEOUT_MS),
    reasoningMinCompletionTokens: resolveOpenAiReasoningMinCompletionTokensFromEnv(
      process.env.WAIA_AI_OPENAI_REASONING_MIN_COMPLETION_TOKENS,
    ),
    parseDiagnostics: isOpenAiParseDiagnosticsEnabled(process.env.WAIA_AI_OPENAI_PARSE_DIAGNOSTICS),
  };
}

/** Twin AI foundation — OpenAI-compatible chat completions (DEE-78). */
export class OpenAiCompatibleCompletionProvider implements CompletionProviderPort {
  async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    return executeOpenAiCompatibleChatCompletion(resolveTwinRuntimeConfig(), req, signal);
  }
}

export function resolveWaiaAiOpenAiDefaultModel(): string {
  const raw = process.env.WAIA_AI_OPENAI_MODEL?.trim();
  return raw !== undefined && raw !== "" ? raw : DEFAULT_OPENAI_MODEL;
}

export function resolveWaiaAiOpenAiTwinDialogueTemperature(): number {
  const raw = process.env.WAIA_AI_OPENAI_TEMPERATURE?.trim();
  if (raw === undefined || raw === "") {
    return 0;
  }
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(2, Math.max(0, n));
}
