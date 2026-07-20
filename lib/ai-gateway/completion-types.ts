/**
 * Vendor-neutral completion contracts (DEE-77) — aligns with DEE-76 §17.
 * Server-side usage only at call sites; types carry no IO.
 */

export type ChatRole = "system" | "user" | "assistant";

export type ProviderMessage = { role: ChatRole; content: string };

export type CompletionResponseFormat = "json_object" | "text";

export type CompletionRequest = {
  model: string;
  messages: ProviderMessage[];
  maxOutputTokens: number;
  temperature?: number;
  /** Vendor-specific structured output; adapters map to API flags. */
  responseFormat?: CompletionResponseFormat;
};

export type CompletionResult =
  | {
      ok: true;
      text: string;
      usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
      providerRequestId?: string;
      finishReason?: string;
    }
  | {
      ok: false;
      code: "RATE_LIMIT" | "TIMEOUT" | "PROVIDER_ERROR" | "CONFIG";
      retryable: boolean;
    };

export interface CompletionProviderPort {
  complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult>;
}
