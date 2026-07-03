import type { ReasoningEnginePort } from "@/lib/trader/research/reasoning-engine.types";

export type ProviderLifecycleState = "fake" | "sandbox" | "production" | "deprecated";

export type ProviderClass = "fake" | "external" | "local" | "waia-foundation";

export type TraderAiProviderId =
  | "fake"
  | "openai-compatible"
  | "anthropic"
  | "gemini"
  | "openrouter"
  | "local"
  | "waia-foundation";

export type ReasoningAuditConfig = {
  providerVersion: string;
  enabled: true;
};

export type ReasoningTelemetryConfig = {
  enabled: true;
  kind: "reasoning";
};

export type TraderAIFoundationProfile = {
  foundationProfile: "ai-trader";
  lifecycle: ProviderLifecycleState;
  providerId: TraderAiProviderId;
  providerClass: ProviderClass;
  model: string;
  reasoningOptIn: boolean;
  reasoningEngine: ReasoningEnginePort;
  executionContext: import("@/lib/trader/research/reasoning-engine.types").ReasoningExecutionContext;
  auditConfig: ReasoningAuditConfig;
  telemetryConfig: ReasoningTelemetryConfig;
};

/** @deprecated Use TraderAIFoundationProfile — retained for transitional imports. */
export type TraderAiFoundationBinding = {
  foundationProfile: "ai-trader";
  providerId: TraderAiProviderId;
  model: string;
  reasoningOptIn: boolean;
};

export function toLegacyFoundationBinding(
  profile: TraderAIFoundationProfile,
): TraderAiFoundationBinding {
  return {
    foundationProfile: profile.foundationProfile,
    providerId: profile.providerId,
    model: profile.model,
    reasoningOptIn: profile.reasoningOptIn,
  };
}
