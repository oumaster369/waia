import type { ProviderMessage } from "@/lib/ai-gateway/completion-types";
import type { TraderAiProviderId } from "@/lib/ai-gateway/trader-ai-foundation.types";

export type ReasoningOutputFormat = "json_object" | "text";

export type ReasoningRequestSpec = {
  model: string;
  messages: ProviderMessage[];
  maxOutputTokens: number;
  temperature: number;
  outputFormat: ReasoningOutputFormat;
};

export type ReasoningTokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type ReasoningEngineCompletion =
  | {
      ok: true;
      text: string;
      usage?: ReasoningTokenUsage;
      providerRequestId?: string;
      finishReason?: string;
      latencyMs: number;
      retryCount: number;
    }
  | {
      ok: false;
      code: "RATE_LIMIT" | "TIMEOUT" | "PROVIDER_ERROR" | "CONFIG" | "BUDGET_EXCEEDED";
      retryable: boolean;
      latencyMs: number;
      retryCount: number;
    };

export type ReasoningExecutionContext = {
  providerId: TraderAiProviderId;
  model: string;
  provider: import("@/lib/ai-gateway/completion-types").CompletionProviderPort;
  maxRetries: number;
};

export interface ReasoningEnginePort {
  complete(
    spec: ReasoningRequestSpec,
    ctx: ReasoningExecutionContext,
    signal?: AbortSignal,
  ): Promise<ReasoningEngineCompletion>;
}
