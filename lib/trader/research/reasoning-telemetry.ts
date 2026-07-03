import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { emitTraderTelemetry } from "@/lib/observability/waia-trader-telemetry";
import type { TraderAIFoundationProfile } from "@/lib/ai-gateway/trader-ai-foundation.types";

export type EmitReasoningSessionTelemetryInput = {
  organizationId: string;
  foundation: TraderAIFoundationProfile;
  reasoningSessionId: string;
  traceId: string;
  outcome: string;
  durationMs: number;
  promptVersion: string;
  reasoningContextDigest: string;
  providerRequestId?: string;
  finishReason?: string;
  retryCount: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export function emitReasoningSessionTelemetry(input: EmitReasoningSessionTelemetryInput): void {
  if (!input.foundation.telemetryConfig.enabled) {
    return;
  }
  emitTraderTelemetry({
    event: "waia_trader_event",
    kind: "reasoning",
    organization_id: input.organizationId,
    outcome: input.outcome,
    severity: "info",
    duration_ms: input.durationMs,
    reasoning_session_id: input.reasoningSessionId,
    trace_id: input.traceId,
    provider: input.foundation.providerId,
    provider_class: input.foundation.providerClass,
    provider_lifecycle: input.foundation.lifecycle,
    model: input.foundation.model,
    prompt_version: input.promptVersion,
    reasoning_context_digest: input.reasoningContextDigest,
    retry_count: input.retryCount,
    ...(input.providerRequestId !== undefined
      ? { provider_request_id: input.providerRequestId }
      : {}),
    ...(input.finishReason !== undefined ? { finish_reason: input.finishReason } : {}),
    ...(input.promptTokens !== undefined ? { prompt_tokens: input.promptTokens } : {}),
    ...(input.completionTokens !== undefined ? { completion_tokens: input.completionTokens } : {}),
    ...(input.totalTokens !== undefined ? { total_tokens: input.totalTokens } : {}),
  });
}
