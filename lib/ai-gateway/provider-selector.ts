import "server-only";

import type { CompletionProviderPort } from "./completion-types";
import { FakeCompletionProvider } from "./fake-completion-provider";
import { OpenAiCompatibleCompletionProvider } from "./openai-compatible-completion-provider";

/** Resolved Twin dialogue completion backend when AI Gateway foundation is enabled (DEE-78). */
export type WaiaAiProviderId = "fake" | "openai-compatible";

const fakeProvider: CompletionProviderPort = new FakeCompletionProvider();
const openAiProvider: CompletionProviderPort = new OpenAiCompatibleCompletionProvider();

/**
 * Selects the active completion provider. Default `fake` — unknown env values resolve to fake (safe default).
 * Live egress requires explicit `WAIA_AI_PROVIDER=openai-compatible` plus foundation gate elsewhere.
 */
export function resolveWaiaAiProviderId(): WaiaAiProviderId {
  const raw = process.env.WAIA_AI_PROVIDER?.trim().toLowerCase();
  if (raw === "openai-compatible") {
    return "openai-compatible";
  }
  return "fake";
}

export function getWaiaAiCompletionProviderForId(id: WaiaAiProviderId): CompletionProviderPort {
  return id === "openai-compatible" ? openAiProvider : fakeProvider;
}

export function resolveWaiaAiCompletionBinding(): {
  providerId: WaiaAiProviderId;
  provider: CompletionProviderPort;
} {
  const providerId = resolveWaiaAiProviderId();
  return { providerId, provider: getWaiaAiCompletionProviderForId(providerId) };
}
