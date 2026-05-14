import "server-only";

import type {
  CompletionProviderPort,
  CompletionRequest,
  CompletionResult,
} from "./completion-types";

/** Mirrors Twin dialogue user message ceiling (`MAX_MESSAGE_CHARS` in twin-dialogue turn route). */
export const WAIA_AI_MAX_ASSISTANT_OUTPUT_CHARS = 16_384;

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/** GPT-5 / o-series Chat Completions use `max_completion_tokens` (counts reasoning + visible). Plain `max_tokens` is deprecated and can yield empty assistant `content` when reasoning exhausts a small budget (OpenAI reasoning guide). */
const DEFAULT_REASONING_COMPLETION_TOKEN_FLOOR = 4096;

function resolveReasoningCompletionTokenFloor(): number {
  const raw = process.env.WAIA_AI_OPENAI_REASONING_MIN_COMPLETION_TOKENS?.trim();
  if (raw === undefined || raw === "") {
    return DEFAULT_REASONING_COMPLETION_TOKEN_FLOOR;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_REASONING_COMPLETION_TOKEN_FLOOR;
  }
  return n;
}

/** Heuristic: reasoning models need `max_completion_tokens` headroom; see OpenAI Chat Completions + reasoning docs. */
export function isOpenAiReasoningChatModelId(model: string): boolean {
  const m = model.trim().toLowerCase();
  return (
    m.startsWith("gpt-5") ||
    m.startsWith("o1") ||
    m.startsWith("o3") ||
    m.startsWith("o4")
  );
}

export function resolveEffectiveMaxCompletionTokens(model: string, maxOutputTokens: number): number {
  if (!isOpenAiReasoningChatModelId(model)) {
    return maxOutputTokens;
  }
  return Math.max(maxOutputTokens, resolveReasoningCompletionTokenFloor());
}

function normalizeOpenAiBaseUrl(raw: string | undefined): string {
  const base = (raw ?? DEFAULT_OPENAI_BASE_URL).trim().replace(/\/+$/, "");
  return base.length > 0 ? base : DEFAULT_OPENAI_BASE_URL;
}

function resolveTimeoutMs(): number {
  const raw = process.env.WAIA_AI_OPENAI_REQUEST_TIMEOUT_MS?.trim();
  if (raw === undefined || raw === "") {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
  return n;
}

type ChatCompletionApiResponse = {
  id?: string;
  choices?: Array<{
    finish_reason?: string;
    message?: {
      role?: string;
      /** Legacy models: string. GPT-5 family and others may return a content-parts array (API: `ChatCompletionContentPartText | refusal`). */
      content?: string | null | OpenAiChatCompletionAssistantContentPart[];
      /** Top-level refusal string on the assistant message (Chat Completions schema). */
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

function isParseDiagnosticsEnabled(): boolean {
  const v = process.env.WAIA_AI_OPENAI_PARSE_DIAGNOSTICS?.trim();
  return v === "1" || v === "true";
}

/**
 * Redacted summary for Worker logs when assistant text cannot be extracted (no user request text).
 * Enable with `WAIA_AI_OPENAI_PARSE_DIAGNOSTICS=1`.
 */
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

/** Redacted top-level keys for OpenAI JSON error bodies (never request messages). */
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

function logOpenAiProviderDiagnostics(payload: Record<string, unknown>): void {
  if (!isParseDiagnosticsEnabled()) {
    return;
  }
  console.warn(JSON.stringify({ waia_ai_diag: "openai_provider_runtime", ...payload }));
}

/**
 * DEE-126 — Chat Completions assistant `message.content` may be a string or an array of parts.
 * Supported part types for extractable text: `text`, `output_text`, `summary_text` (string `text` field).
 * Refusal: top-level `message.refusal`, or a part with `type: "refusal"` (no assistant text).
 * Mixed text + refusal arrays are rejected if any refusal part is present (OpenAI: refusal is exclusive).
 */
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
    const t = part.type;
    if (t === "refusal") {
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
  if (joined.length > 0) {
    return joined;
  }

  return undefined;
}

/**
 * OpenAI `v1/chat/completions` over HTTPS via `fetch` — OpenAI-compatible base URLs supported (DEE-78).
 * No retries; no SDK dependency.
 */
export class OpenAiCompatibleCompletionProvider implements CompletionProviderPort {
  async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    const apiKey = process.env.WAIA_AI_OPENAI_API_KEY?.trim();
    if (apiKey === undefined || apiKey === "") {
      logOpenAiProviderDiagnostics({
        internal_error_category: "config_missing_api_key",
        result_code: "CONFIG",
        request_model: req.model,
      });
      return { ok: false, code: "CONFIG", retryable: false };
    }

    if (signal?.aborted) {
      logOpenAiProviderDiagnostics({
        internal_error_category: "client_signal_aborted_before_fetch",
        result_code: "PROVIDER_ERROR",
        request_model: req.model,
      });
      return { ok: false, code: "PROVIDER_ERROR", retryable: false };
    }

    const timeoutMs = resolveTimeoutMs();
    const ac = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, timeoutMs);

    if (signal !== undefined) {
      signal.addEventListener("abort", () => ac.abort(), { once: true });
    }

    const baseUrl = normalizeOpenAiBaseUrl(process.env.WAIA_AI_OPENAI_BASE_URL);
    const url = `${baseUrl}/v1/chat/completions`;

    const maxCompletionTokens = resolveEffectiveMaxCompletionTokens(req.model, req.maxOutputTokens);
    const body = {
      model: req.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      max_completion_tokens: maxCompletionTokens,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    };

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
        logOpenAiProviderDiagnostics({
          internal_error_category: "fetch_aborted",
          result_code: "PROVIDER_ERROR",
          request_model: req.model,
        });
        return { ok: false, code: "PROVIDER_ERROR", retryable: false };
      }
      if (timedOut) {
        logOpenAiProviderDiagnostics({
          internal_error_category: "fetch_timeout",
          result_code: "TIMEOUT",
          request_model: req.model,
        });
        return { ok: false, code: "TIMEOUT", retryable: false };
      }
      logOpenAiProviderDiagnostics({
        internal_error_category: "fetch_network_or_unknown",
        result_code: "PROVIDER_ERROR",
        request_model: req.model,
      });
      return { ok: false, code: "PROVIDER_ERROR", retryable: false };
    }

    clearTimeout(timeoutId);

    const status = response.status;
    if (status === 401 || status === 403) {
      logOpenAiProviderDiagnostics({
        internal_error_category: "http_auth_config",
        http_status: status,
        result_code: "CONFIG",
        request_model: req.model,
      });
      return { ok: false, code: "CONFIG", retryable: false };
    }
    if (status === 429) {
      logOpenAiProviderDiagnostics({
        internal_error_category: "http_rate_limit",
        http_status: status,
        result_code: "RATE_LIMIT",
        request_model: req.model,
      });
      return { ok: false, code: "RATE_LIMIT", retryable: false };
    }
    if (status >= 500) {
      logOpenAiProviderDiagnostics({
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
      logOpenAiProviderDiagnostics({
        internal_error_category: "response_body_not_json",
        http_status: status,
        result_code: "PROVIDER_ERROR",
        request_model: req.model,
      });
      return { ok: false, code: "PROVIDER_ERROR", retryable: false };
    }

    if (!response.ok || parsed === null || typeof parsed !== "object") {
      logOpenAiProviderDiagnostics({
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
    const message = obj.choices?.[0]?.message;
    const trimmed =
      message !== undefined ? coerceOpenAiAssistantMessageContentToTrimmedString(message) : undefined;
    if (trimmed === undefined) {
      const maxCompletionTokens = resolveEffectiveMaxCompletionTokens(req.model, req.maxOutputTokens);
      logOpenAiProviderDiagnostics({
        ...summarizeOpenAiAssistantParseFailure(parsed, req.model),
        max_completion_tokens_effective: maxCompletionTokens,
        is_reasoning_model_id: isOpenAiReasoningChatModelId(req.model),
        internal_error_category: "assistant_visible_text_empty_or_unparsed",
        result_code: "PROVIDER_ERROR",
      });
      return { ok: false, code: "PROVIDER_ERROR", retryable: false };
    }

    if (trimmed.length > WAIA_AI_MAX_ASSISTANT_OUTPUT_CHARS) {
      logOpenAiProviderDiagnostics({
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
    };
  }
}

/** Model id from env when the gateway builds an OpenAI-compat {@link CompletionRequest}. */
export function resolveWaiaAiOpenAiDefaultModel(): string {
  const raw = process.env.WAIA_AI_OPENAI_MODEL?.trim();
  return raw !== undefined && raw !== "" ? raw : DEFAULT_OPENAI_MODEL;
}

/**
 * Twin dialogue sampling temperature for OpenAI-compatible chat completions (DEE-126).
 * Unset or invalid → `0` (matches pre–DEE-126 hardcoded behavior). Clamped to [0, 2].
 */
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
