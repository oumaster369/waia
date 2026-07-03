import "server-only";

import type { CompletionProviderPort } from "@/lib/ai-gateway/completion-types";
import { FakeCompletionProvider } from "@/lib/ai-gateway/fake-completion-provider";
import type {
  ProviderClass,
  ProviderLifecycleState,
  TraderAiProviderId,
} from "@/lib/ai-gateway/trader-ai-foundation.types";
import { TraderOpenAiCompatibleCompletionProvider } from "@/lib/ai-gateway/trader-openai-compatible-completion-provider";

export type TraderProviderRegistryEntry = {
  providerId: TraderAiProviderId;
  providerClass: ProviderClass;
  lifecycle: ProviderLifecycleState;
  createAdapter: () => CompletionProviderPort;
};

const fakeAdapter = new FakeCompletionProvider();
const traderOpenAiAdapter = new TraderOpenAiCompatibleCompletionProvider();

export const TRADER_PROVIDER_REGISTRY: readonly TraderProviderRegistryEntry[] = [
  {
    providerId: "fake",
    providerClass: "fake",
    lifecycle: "fake",
    createAdapter: () => fakeAdapter,
  },
  {
    providerId: "openai-compatible",
    providerClass: "external",
    lifecycle: "production",
    createAdapter: () => traderOpenAiAdapter,
  },
];

export function resolveProviderClass(providerId: TraderAiProviderId): ProviderClass {
  if (providerId === "fake") {
    return "fake";
  }
  if (providerId === "local") {
    return "local";
  }
  if (providerId === "waia-foundation") {
    return "waia-foundation";
  }
  return "external";
}

export function createTraderProviderAdapter(
  providerId: TraderAiProviderId,
  lifecycle: ProviderLifecycleState,
): CompletionProviderPort {
  if (lifecycle === "deprecated") {
    return {
      async complete() {
        return { ok: false, code: "CONFIG", retryable: false };
      },
    };
  }
  const entry = TRADER_PROVIDER_REGISTRY.find((e) => e.providerId === providerId);
  if (entry === undefined) {
    return fakeAdapter;
  }
  return entry.createAdapter();
}
