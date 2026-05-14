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
    message?: {
      role?: string;
      /** Legacy models: string. GPT-5 family and others may return a content-parts array (API: `ChatCompletionContentPartText | refusal`). */
      content?: string | null | OpenAiChatCompletionAssistantContentPart[];
      refusal?: string | null;
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

/**
 * DEE-126 — Chat Completions assistant `message.content` may be a string or an array of parts
 * (`{ type: "text", text }` / `{ type: "refusal", refusal }`) on newer OpenAI models.
 * This path previously required `typeof content === "string"`, causing fast `provider_error` stubs for `gpt-5.5`.
 */
function coerceOpenAiAssistantMessageContentToTrimmedString(message: {
  content?: string | null | OpenAiChatCompletionAssistantContentPart[];
  refusal?: string | null;
}): string | undefined {
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

  const textPieces: string[] = [];
  for (const part of raw) {
    if (part === null || typeof part !== "object") {
      continue;
    }
    const t = part.type;
    if (t === "refusal") {
      return undefined;
    }
    if (t === "text" && typeof part.text === "string") {
      textPieces.push(part.text);
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
      return { ok: false, code: "CONFIG", retryable: false };
    }

    if (signal?.aborted) {
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

    const body = {
      model: req.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: req.maxOutputTokens,
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
        return { ok: false, code: "PROVIDER_ERROR", retryable: false };
      }
      if (timedOut) {
        return { ok: false, code: "TIMEOUT", retryable: false };
      }
      return { ok: false, code: "PROVIDER_ERROR", retryable: false };
    }

    clearTimeout(timeoutId);

    const status = response.status;
    if (status === 401 || status === 403) {
      return { ok: false, code: "CONFIG", retryable: false };
    }
    if (status === 429) {
      return { ok: false, code: "RATE_LIMIT", retryable: false };
    }
    if (status >= 500) {
      return { ok: false, code: "PROVIDER_ERROR", retryable: true };
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return { ok: false, code: "PROVIDER_ERROR", retryable: false };
    }

    if (!response.ok || parsed === null || typeof parsed !== "object") {
      return { ok: false, code: "PROVIDER_ERROR", retryable: status >= 500 };
    }

    const obj = parsed as ChatCompletionApiResponse;
    const message = obj.choices?.[0]?.message;
    const trimmed =
      message !== undefined ? coerceOpenAiAssistantMessageContentToTrimmedString(message) : undefined;
    if (trimmed === undefined) {
      return { ok: false, code: "PROVIDER_ERROR", retryable: false };
    }

    if (trimmed.length > WAIA_AI_MAX_ASSISTANT_OUTPUT_CHARS) {
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
