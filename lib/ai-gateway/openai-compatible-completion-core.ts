import type { CompletionRequest, CompletionResult } from "@/lib/ai-gateway/completion-types";

/** Mirrors Twin dialogue user message ceiling (`MAX_MESSAGE_CHARS` in twin-dialogue turn route). */
export const WAIA_AI_MAX_ASSISTANT_OUTPUT_CHARS = 16_384;

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_REASONING_COMPLETION_TOKEN_FLOOR = 4096;

export type OpenAiCompatibleRuntimeConfig = {
  apiKey: string | undefined;
  baseUrl: string;
  timeoutMs: number;
  reasoningMinCompletionTokens: number;
  parseDiagnostics: boolean;
};

type ChatCompletionApiResponse = {
  id?: string;
  choices?: Array<{
    finish_reason?: string;
    message?: {
      role?: string;
      content?: string | null | OpenAiChatCompletionAssistantContentPart[];
      refusal?: string | null;
      tool_calls?: unknown;
      annotations?: unknown;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type OpenAiChatCompletionAssistantContentPart = {
  type?: string;
  text?: string;
  refusal?: string;
};

/** Heuristic: reasoning models need `max_completion_tokens` headroom. */
export function isOpenAiReasoningChatModelId(model: string): boolean {
  const m = model.trim().toLowerCase();
  return m.startsWith("gpt-5") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4");
}

export function resolveEffectiveMaxCompletionTokens(
  model: string,
  maxOutputTokens: number,
  reasoningMinCompletionTokens: number,
): number {
  if (!isOpenAiReasoningChatModelId(model)) {
    return maxOutputTokens;
  }
  return Math.max(maxOutputTokens, reasoningMinCompletionTokens);
}

export function normalizeOpenAiBaseUrl(raw: string | undefined): string {
  const base = (raw ?? DEFAULT_OPENAI_BASE_URL).trim().replace(/\/+$/, "");
  return base.length > 0 ? base : DEFAULT_OPENAI_BASE_URL;
}

export function summarizeOpenAiAssistantParseFailure(
  parsed: unknown,
  model: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    waia_ai_diag: "openai_assistant_parse_failure",
    request_model: model,
  };
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...base, parsed_kind: parsed === null ? "null" : typeof parsed };
  }
  const o = parsed as ChatCompletionApiResponse;
  const choice0 = o.choices?.[0];
  const msg = choice0?.message;
  const content = msg?.content;
  const partTypes: string[] = [];
  const partKeySets: string[][] = [];
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part === null || typeof part !== "object") {
        partTypes.push(typeof part);
        continue;
      }
      const p = part as Record<string, unknown>;
      partTypes.push(typeof p.type === "string" ? p.type : "(missing_type)");
      partKeySets.push(Object.keys(p).sort());
    }
  }
  return {
    ...base,
    choices_length: Array.isArray(o.choices) ? o.choices.length : undefined,
    provider_request_id: typeof o.id === "string" ? o.id : undefined,
    finish_reason: typeof choice0?.finish_reason === "string" ? choice0.finish_reason : undefined,
    has_message: msg !== undefined,
    message_keys: msg !== undefined ? Object.keys(msg).sort() : undefined,
    content_kind:
      content === null
        ? "null"
        : content === undefined
          ? "undefined"
          : Array.isArray(content)
            ? "array"
            : typeof content,
    content_array_length: Array.isArray(content) ? content.length : undefined,
    content_array_part_types: Array.isArray(content) ? partTypes : undefined,
    content_array_part_keys: Array.isArray(content) ? partKeySets : undefined,
    message_refusal_len:
      typeof msg?.refusal === "string" ? msg.refusal.length : msg?.refusal === null ? 0 : undefined,
    has_tool_calls: msg?.tool_calls !== undefined && msg.tool_calls !== null,
    visible_text_extracted: false,
  };
}

export function summarizeOpenAiHttpErrorBody(parsed: unknown): Record<string, unknown> {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error_body_kind: parsed === null ? "null" : typeof parsed };
  }
  const o = parsed as Record<string, unknown>;
  const errRaw = o.error;
  if (errRaw === null || typeof errRaw !== "object" || Array.isArray(errRaw)) {
    return {
      error_body_keys: Object.keys(o).sort(),
      error_object_kind:
        errRaw === null ? "null" : errRaw === undefined ? "undefined" : typeof errRaw,
    };
  }
  const err = errRaw as Record<string, unknown>;
  const msg = err.message;
  return {
    error_body_keys: Object.keys(o).sort(),
    openai_error_keys: Object.keys(err).sort(),
    openai_error_type: typeof err.type === "string" ? err.type : undefined,
    openai_error_code: typeof err.code === "string" ? err.code : undefined,
    openai_error_param: typeof err.param === "string" ? err.param : undefined,
    openai_error_message_len: typeof msg === "string" ? msg.length : undefined,
  };
}

function logOpenAiProviderDiagnostics(
  parseDiagnostics: boolean,
  payload: Record<string, unknown>,
): void {
  if (!parseDiagnostics) {
    return;
  }
  console.warn(JSON.stringify({ waia_ai_diag: "openai_provider_runtime", ...payload }));
}

function coerceOpenAiAssistantMessageContentToTrimmedString(message: {
  content?: string | null | OpenAiChatCompletionAssistantContentPart[];
  refusal?: string | null;
}): string | undefined {
  if (typeof message.refusal === "string" && message.refusal.trim().length > 0) {
    return undefined;
  }

  const raw = message.content;

  if (typeof raw === "string") {
    return raw.trim().length > 0 ? raw.trim() : undefined;
  }

  if (raw === null || raw === undefined) {
    return undefined;
  }

  if (!Array.isArray(raw)) {
    return undefined;
  }

  for (const part of raw) {
    if (part === null || typeof part !== "object") {
      continue;
    }
    if (part.type === "refusal") {
      return undefined;
    }
  }

  const textPieces: string[] = [];
  for (const part of raw) {
    if (part === null || typeof part !== "object") {
      continue;
    }
    const t = part.type;
    if (t === "text" || t === "output_text" || t === "summary_text") {
      if (typeof part.text === "string") {
        textPieces.push(part.text);
      }
    }
  }

  const joined = textPieces.join("").trim();
  return joined.length > 0 ? joined : undefined;
}

export async function executeOpenAiCompatibleChatCompletion(
  config: OpenAiCompatibleRuntimeConfig,
  req: CompletionRequest,
  signal?: AbortSignal,
): Promise<CompletionResult> {
  const apiKey = config.apiKey?.trim();
  if (apiKey === undefined || apiKey === "") {
    logOpenAiProviderDiagnostics(config.parseDiagnostics, {
      internal_error_category: "config_missing_api_key",
      result_code: "CONFIG",
      request_model: req.model,
    });
    return { ok: false, code: "CONFIG", retryable: false };
  }

  if (signal?.aborted) {
    logOpenAiProviderDiagnostics(config.parseDiagnostics, {
      internal_error_category: "client_signal_aborted_before_fetch",
      result_code: "PROVIDER_ERROR",
      request_model: req.model,
    });
    return { ok: false, code: "PROVIDER_ERROR", retryable: false };
  }

  const ac = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, config.timeoutMs);

  if (signal !== undefined) {
    signal.addEventListener("abort", () => ac.abort(), { once: true });
  }

  const url = `${config.baseUrl}/v1/chat/completions`;
  const maxCompletionTokens = resolveEffectiveMaxCompletionTokens(
    req.model,
    req.maxOutputTokens,
    config.reasoningMinCompletionTokens,
  );
  const reasoningModel = isOpenAiReasoningChatModelId(req.model);
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    max_completion_tokens: maxCompletionTokens,
    ...(req.temperature !== undefined && !reasoningModel ? { temperature: req.temperature } : {}),
  };
  if (req.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch {
    clearTimeout(timeoutId);
    if (signal?.aborted) {
      logOpenAiProviderDiagnostics(config.parseDiagnostics, {
        internal_error_category: "fetch_aborted",
        result_code: "PROVIDER_ERROR",
        request_model: req.model,
      });
      return { ok: false, code: "PROVIDER_ERROR", retryable: false };
    }
    if (timedOut) {
      logOpenAiProviderDiagnostics(config.parseDiagnostics, {
        internal_error_category: "fetch_timeout",
        result_code: "TIMEOUT",
        request_model: req.model,
      });
      return { ok: false, code: "TIMEOUT", retryable: false };
    }
    logOpenAiProviderDiagnostics(config.parseDiagnostics, {
      internal_error_category: "fetch_network_or_unknown",
      result_code: "PROVIDER_ERROR",
      request_model: req.model,
    });
    return { ok: false, code: "PROVIDER_ERROR", retryable: false };
  }

  clearTimeout(timeoutId);

  const status = response.status;
  if (status === 401 || status === 403) {
    logOpenAiProviderDiagnostics(config.parseDiagnostics, {
      internal_error_category: "http_auth_config",
      http_status: status,
      result_code: "CONFIG",
      request_model: req.model,
    });
    return { ok: false, code: "CONFIG", retryable: false };
  }
  if (status === 429) {
    logOpenAiProviderDiagnostics(config.parseDiagnostics, {
      internal_error_category: "http_rate_limit",
      http_status: status,
      result_code: "RATE_LIMIT",
      request_model: req.model,
    });
    return { ok: false, code: "RATE_LIMIT", retryable: false };
  }
  if (status >= 500) {
    logOpenAiProviderDiagnostics(config.parseDiagnostics, {
      internal_error_category: "http_server_error",
      http_status: status,
      result_code: "PROVIDER_ERROR",
      retryable: true,
      request_model: req.model,
    });
    return { ok: false, code: "PROVIDER_ERROR", retryable: true };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    logOpenAiProviderDiagnostics(config.parseDiagnostics, {
      internal_error_category: "response_body_not_json",
      http_status: status,
      result_code: "PROVIDER_ERROR",
      request_model: req.model,
    });
    return { ok: false, code: "PROVIDER_ERROR", retryable: false };
  }

  if (!response.ok || parsed === null || typeof parsed !== "object") {
    logOpenAiProviderDiagnostics(config.parseDiagnostics, {
      internal_error_category: "http_non_success_or_non_object_body",
      http_status: status,
      response_ok: response.ok,
      parsed_kind: parsed === null ? "null" : typeof parsed,
      result_code: "PROVIDER_ERROR",
      retryable: status >= 500,
      request_model: req.model,
      ...summarizeOpenAiHttpErrorBody(parsed),
    });
    return { ok: false, code: "PROVIDER_ERROR", retryable: status >= 500 };
  }

  const obj = parsed as ChatCompletionApiResponse;
  const choice0 = obj.choices?.[0];
  const message = choice0?.message;
  const trimmed =
    message !== undefined ? coerceOpenAiAssistantMessageContentToTrimmedString(message) : undefined;
  if (trimmed === undefined) {
    logOpenAiProviderDiagnostics(config.parseDiagnostics, {
      ...summarizeOpenAiAssistantParseFailure(parsed, req.model),
      max_completion_tokens_effective: maxCompletionTokens,
      is_reasoning_model_id: isOpenAiReasoningChatModelId(req.model),
      internal_error_category: "assistant_visible_text_empty_or_unparsed",
      result_code: "PROVIDER_ERROR",
    });
    return { ok: false, code: "PROVIDER_ERROR", retryable: false };
  }

  if (trimmed.length > WAIA_AI_MAX_ASSISTANT_OUTPUT_CHARS) {
    logOpenAiProviderDiagnostics(config.parseDiagnostics, {
      internal_error_category: "assistant_output_exceeds_waia_cap",
      assistant_text_len: trimmed.length,
      waia_cap: WAIA_AI_MAX_ASSISTANT_OUTPUT_CHARS,
      result_code: "PROVIDER_ERROR",
      request_model: req.model,
    });
    return { ok: false, code: "PROVIDER_ERROR", retryable: false };
  }

  const usage = obj.usage;
  return {
    ok: true,
    text: trimmed,
    usage:
      usage !== undefined
        ? {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
          }
        : undefined,
    providerRequestId: typeof obj.id === "string" ? obj.id : undefined,
    finishReason: typeof choice0?.finish_reason === "string" ? choice0.finish_reason : undefined,
  };
}

export function resolveOpenAiReasoningMinCompletionTokensFromEnv(
  envValue: string | undefined,
): number {
  if (envValue === undefined || envValue.trim() === "") {
    return DEFAULT_REASONING_COMPLETION_TOKEN_FLOOR;
  }
  const n = Number.parseInt(envValue, 10);
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_REASONING_COMPLETION_TOKEN_FLOOR;
  }
  return n;
}

export function resolveOpenAiTimeoutMsFromEnv(envValue: string | undefined): number {
  if (envValue === undefined || envValue.trim() === "") {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
  const n = Number.parseInt(envValue, 10);
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
  return n;
}

export function isOpenAiParseDiagnosticsEnabled(envValue: string | undefined): boolean {
  const v = envValue?.trim();
  return v === "1" || v === "true";
}
