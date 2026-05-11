import "server-only";

import { TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE } from "@/lib/dashboard/twin-dialogue-stub";

import type {
  CompletionProviderPort,
  CompletionRequest,
  CompletionResult,
} from "./completion-types";

/**
 * No-network provider stub for exercising {@link CompletionProviderPort} wiring (DEE-77).
 * Deterministic; ignores request shape aside from honoring AbortSignal when aborted.
 */
export class FakeCompletionProvider implements CompletionProviderPort {
  async complete(_req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    if (signal?.aborted) {
      return { ok: false, code: "PROVIDER_ERROR", retryable: false };
    }
    return {
      ok: true,
      text: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }
}
