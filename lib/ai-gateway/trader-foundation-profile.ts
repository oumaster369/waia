import "server-only";

import { buildPolicyWrappedCompletionProvider } from "@/lib/ai-gateway/trader-foundation-policies";
import type {
  ProviderClass,
  ProviderLifecycleState,
  TraderAiFoundationBinding,
  TraderAiProviderId,
  TraderAIFoundationProfile,
} from "@/lib/ai-gateway/trader-ai-foundation.types";
import { toLegacyFoundationBinding } from "@/lib/ai-gateway/trader-ai-foundation.types";
import {
  createTraderProviderAdapter,
  resolveProviderClass,
} from "@/lib/ai-gateway/trader-provider-registry";
import { traderReasoningEngine } from "@/lib/ai-gateway/trader-reasoning-engine";
import {
  resolveTraderOpenAiDefaultModel,
  resolveTraderOpenAiMaxRetries,
  TRADER_OPENAI_ADAPTER_VERSION,
} from "@/lib/ai-gateway/trader-openai-compatible-completion-provider";
import type { ReasoningExecutionContext } from "@/lib/trader/research/reasoning-engine.types";

export type { TraderAiProviderId, TraderAIFoundationProfile, TraderAiFoundationBinding };

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

function resolveDailyTokenBudget(): number | undefined {
  const raw = process.env.WAIA_AI_TRADER_DAILY_TOKEN_BUDGET?.trim();
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    return undefined;
  }
  return n;
}

function resolveRateLimitRpm(): number | undefined {
  const raw = process.env.WAIA_AI_TRADER_RATE_LIMIT_RPM?.trim();
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    return undefined;
  }
  return n;
}

export function resolveProviderLifecycleState(
  liveEgressRequested: boolean,
): ProviderLifecycleState {
  if (!liveEgressRequested) {
    return "fake";
  }
  const raw = process.env.WAIA_AI_TRADER_PROVIDER_LIFECYCLE?.trim().toLowerCase();
  if (raw === "sandbox" || raw === "production" || raw === "deprecated") {
    return raw;
  }
  return "production";
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

function resolveTraderModel(providerId: TraderAiProviderId): string {
  if (providerId === "openai-compatible") {
    return resolveTraderOpenAiDefaultModel();
  }
  const configured = process.env.WAIA_AI_TRADER_OPENAI_MODEL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_TRADER_MODEL;
}

function resolveEffectiveProviderId(
  requested: TraderAiProviderId,
  lifecycle: ProviderLifecycleState,
): TraderAiProviderId {
  if (lifecycle === "fake") {
    return "fake";
  }
  if (lifecycle === "deprecated") {
    return requested;
  }
  if (requested === "openai-compatible") {
    const traderKey = process.env.WAIA_AI_TRADER_OPENAI_API_KEY?.trim();
    if (traderKey === undefined || traderKey === "") {
      return "openai-compatible";
    }
    return "openai-compatible";
  }
  return "fake";
}

function buildExecutionContext(
  providerId: TraderAiProviderId,
  lifecycle: ProviderLifecycleState,
  model: string,
): ReasoningExecutionContext {
  const adapter = createTraderProviderAdapter(providerId, lifecycle);
  const wrapped = buildPolicyWrappedCompletionProvider(adapter, {
    dailyTokenBudget: resolveDailyTokenBudget(),
    rateLimitRpm: resolveRateLimitRpm(),
  });
  return {
    providerId,
    model,
    provider: wrapped,
    maxRetries: providerId === "fake" ? 0 : resolveTraderOpenAiMaxRetries(),
  };
}

export function resolveTraderAIFoundation(): TraderAIFoundationProfile {
  const reasoningOptIn = isWaiaTraderSeeAiReasoningEnabled();
  const requestedProvider = resolveWaiaAiTraderProviderId();
  const liveEgressRequested =
    reasoningOptIn && isWaiaAiTraderGatewayFoundationEnabled() && requestedProvider !== "fake";
  const lifecycle = resolveProviderLifecycleState(liveEgressRequested);
  const providerId = resolveEffectiveProviderId(requestedProvider, lifecycle);
  const providerClass: ProviderClass = resolveProviderClass(providerId);
  const model = resolveTraderModel(providerId);

  return {
    foundationProfile: "ai-trader",
    lifecycle,
    providerId,
    providerClass,
    model,
    reasoningOptIn,
    reasoningEngine: traderReasoningEngine,
    executionContext: buildExecutionContext(providerId, lifecycle, model),
    auditConfig: {
      providerVersion: TRADER_OPENAI_ADAPTER_VERSION,
      enabled: true,
    },
    telemetryConfig: {
      enabled: true,
      kind: "reasoning",
    },
  };
}

/** @deprecated Use resolveTraderAIFoundation — retained for transitional call sites. */
export function resolveWaiaAiTraderFoundationBinding(): TraderAiFoundationBinding & {
  provider: ReasoningExecutionContext["provider"];
} {
  const profile = resolveTraderAIFoundation();
  return {
    ...toLegacyFoundationBinding(profile),
    provider: profile.executionContext.provider,
  };
}

export function isTraderReasoningFakePath(profile: TraderAIFoundationProfile): boolean {
  return profile.lifecycle === "fake" || profile.providerId === "fake";
}
