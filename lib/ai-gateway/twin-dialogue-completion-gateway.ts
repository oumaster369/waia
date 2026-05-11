import "server-only";

import { TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE } from "@/lib/dashboard/twin-dialogue-stub";

import { isWaiaAiGatewayFoundationEnabled } from "./config";
import type { CompletionProviderPort, CompletionRequest } from "./completion-types";
import { FakeCompletionProvider } from "./fake-completion-provider";

export type TwinDialogueGatewayFoundationTelemetry =
  | { foundation: "off" }
  | { foundation: "fake_stub"; provider_phase_ms: number; degraded?: boolean };

const fakeCompletionProvider: CompletionProviderPort = new FakeCompletionProvider();

/**
 * Resolves assistant reply text for Twin dialogue turns — stub-backed through DEE-77.
 * No outbound inference; {@link isWaiaAiGatewayFoundationEnabled} only selects code path.
 */
export async function resolveTwinDialogueAssistantText(input: {
  userContent: string;
  signal?: AbortSignal;
}): Promise<{ text: string; telemetry: TwinDialogueGatewayFoundationTelemetry }> {
  if (!isWaiaAiGatewayFoundationEnabled()) {
    return {
      text: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
      telemetry: { foundation: "off" },
    };
  }

  const started = Date.now();
  const request: CompletionRequest = {
    model: "fake/no-network",
    messages: [
      {
        role: "system",
        content:
          "WAIA Twin dialogue foundation layer — no external inference in this deployment slice.",
      },
      { role: "user", content: input.userContent },
    ],
    maxOutputTokens: 256,
    temperature: 0,
  };

  const result = await fakeCompletionProvider.complete(request, input.signal);
  const provider_phase_ms = Date.now() - started;

  if (!result.ok) {
    return {
      text: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
      telemetry: { foundation: "fake_stub", provider_phase_ms, degraded: true },
    };
  }

  return {
    text: result.text,
    telemetry: { foundation: "fake_stub", provider_phase_ms },
  };
}
