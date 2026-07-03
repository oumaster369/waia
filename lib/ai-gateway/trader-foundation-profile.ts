import "server-only";

import type { CompletionProviderPort } from "@/lib/ai-gateway/completion-types";
import { FakeCompletionProvider } from "@/lib/ai-gateway/fake-completion-provider";

export type TraderAiProviderId = "fake" | "openai-compatible";

export type TraderAiFoundationBinding = {
  foundationProfile: "ai-trader";
  providerId: TraderAiProviderId;
  model: string;
  provider: CompletionProviderPort;
  reasoningOptIn: boolean;
};

const DEFAULT_TRADER_MODEL = "waia-trader-reasoning-v1";

function isTruthyEnv(raw: string | undefined): boolean {
  const normalized = raw?.trim().toLowerCase() ?? "";
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isWaiaAiTraderGatewayFoundationEnabled(): boolean {
  return isTruthyEnv(process.env.WAIA_AI_TRADER_GATEWAY_FOUNDATION);
}

export function isWaiaTraderSeeAiReasoningEnabled(): boolean {
  return isTruthyEnv(process.env.WAIA_TRADER_SEE_AI_REASONING);
}

export function resolveWaiaAiTraderProviderId(): TraderAiProviderId {
  if (!isWaiaAiTraderGatewayFoundationEnabled() || !isWaiaTraderSeeAiReasoningEnabled()) {
    return "fake";
  }
  const raw = process.env.WAIA_AI_TRADER_PROVIDER?.trim().toLowerCase();
  if (raw === "openai-compatible") {
    return "openai-compatible";
  }
  return "fake";
}

function resolveTraderModel(): string {
  const configured = process.env.WAIA_AI_TRADER_OPENAI_MODEL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_TRADER_MODEL;
}

/**
 * R1: returns FakeCompletionProvider unless trader foundation + reasoning opt-in + openai-compatible
 * are all configured with a trader API key. Never reads WAIA_AI_OPENAI_API_KEY (Twin namespace).
 */
export function resolveWaiaAiTraderFoundationBinding(): TraderAiFoundationBinding {
  const providerId = resolveWaiaAiTraderProviderId();
  const reasoningOptIn = isWaiaTraderSeeAiReasoningEnabled();
  const model = resolveTraderModel();

  if (providerId === "openai-compatible") {
    const traderKey = process.env.WAIA_AI_TRADER_OPENAI_API_KEY?.trim();
    if (traderKey === undefined || traderKey === "") {
      return {
        foundationProfile: "ai-trader",
        providerId: "fake",
        model,
        provider: new FakeCompletionProvider(),
        reasoningOptIn,
      };
    }
    // R2 will wire TraderOpenAiCompatibleCompletionProvider reading WAIA_AI_TRADER_* only.
    // R1 fail-closed: missing dedicated adapter → fake provider.
    return {
      foundationProfile: "ai-trader",
      providerId: "fake",
      model,
      provider: new FakeCompletionProvider(),
      reasoningOptIn,
    };
  }

  return {
    foundationProfile: "ai-trader",
    providerId: "fake",
    model,
    provider: new FakeCompletionProvider(),
    reasoningOptIn,
  };
}
