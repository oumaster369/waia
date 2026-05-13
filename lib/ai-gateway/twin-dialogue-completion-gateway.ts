import "server-only";

import { TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE } from "@/lib/dashboard/twin-dialogue-stub";
import type { WaiaAiGatewayProviderOutcomeTelemetry } from "@/lib/observability/waia-runtime-route-telemetry";

import { isWaiaAiGatewayFoundationEnabled } from "./config";
import type { CompletionRequest, ProviderMessage } from "./completion-types";
import { resolveWaiaAiCompletionBinding, type WaiaAiProviderId } from "./provider-selector";
import { resolveWaiaAiOpenAiDefaultModel } from "./openai-compatible-completion-provider";

const TWIN_DIALOGUE_SYSTEM_BASE =
  "WAIA Twin dialogue — AI-Twin training assistant. Be concise, dialogical, and supportive.";

const TWIN_DIALOGUE_SYSTEM_WITH_REPLAY_TAIL =
  `${TWIN_DIALOGUE_SYSTEM_BASE} Continue naturally from the recent exchange below; acknowledge emotional continuity without repeating verbatim. Do not reset the rapport or contradict prior turns without inviting clarification.`;

const TWIN_DIALOGUE_SYSTEM_STUB =
  "WAIA Twin dialogue foundation layer — no external inference in this deployment slice.";

export type TwinDialogueGatewayFoundationTelemetry =
  | { foundation: "off" }
  | TwinDialogueGatewayFoundationActiveTelemetry;

export type TwinDialogueGatewayFoundationActiveTelemetry = {
  foundation: "fake_stub" | "live";
  providerId: WaiaAiProviderId;
  providerOutcome: WaiaAiGatewayProviderOutcomeTelemetry;
  provider_phase_ms: number;
  degraded?: boolean;
  /** Present when the completion adapter returned usage metadata (DEE-79). */
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  providerRequestId?: string;
};

function buildTwinDialogueCompletionRequest(
  userContent: string,
  providerId: WaiaAiProviderId,
  priorReplay: readonly ProviderMessage[] | undefined,
): CompletionRequest {
  const hasReplay = priorReplay != null && priorReplay.length > 0;
  const systemText = hasReplay ? TWIN_DIALOGUE_SYSTEM_WITH_REPLAY_TAIL : TWIN_DIALOGUE_SYSTEM_BASE;

  const historyMessages = hasReplay
    ? [...priorReplay, { role: "user" as const, content: userContent }]
    : [{ role: "user" as const, content: userContent }];

  if (providerId === "fake") {
    return {
      model: "fake/no-network",
      messages: [{ role: "system", content: TWIN_DIALOGUE_SYSTEM_STUB }, ...historyMessages],
      maxOutputTokens: 256,
      temperature: 0,
    };
  }

  return {
    model: resolveWaiaAiOpenAiDefaultModel(),
    messages: [{ role: "system", content: systemText }, ...historyMessages],
    maxOutputTokens: 256,
    temperature: 0,
  };
}

function telemetryOutcomeFromFailedCompletion(
  code: "RATE_LIMIT" | "TIMEOUT" | "PROVIDER_ERROR" | "CONFIG",
): WaiaAiGatewayProviderOutcomeTelemetry {
  switch (code) {
    case "RATE_LIMIT":
      return "rate_limit";
    case "TIMEOUT":
      return "timeout";
    case "CONFIG":
      return "config";
    case "PROVIDER_ERROR":
      return "provider_error";
  }
}

/**
 * Resolves assistant reply text for Twin dialogue turns — stub fallback remains MVP-safe (DEE-77 / DEE-78).
 * Optional `priorReplayMessages` bounded replay slice (DEE-109): only consulted when gateway foundation is enabled.
 */
export async function resolveTwinDialogueAssistantText(input: {
  userContent: string;
  priorReplayMessages?: readonly ProviderMessage[] | undefined;
  signal?: AbortSignal;
}): Promise<{ text: string; telemetry: TwinDialogueGatewayFoundationTelemetry }> {
  if (!isWaiaAiGatewayFoundationEnabled()) {
    return {
      text: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
      telemetry: { foundation: "off" },
    };
  }

  const { providerId, provider } = resolveWaiaAiCompletionBinding();
  const request = buildTwinDialogueCompletionRequest(
    input.userContent,
    providerId,
    input.priorReplayMessages,
  );

  const started = Date.now();
  const result = await provider.complete(request, input.signal);
  const provider_phase_ms = Date.now() - started;

  if (!result.ok) {
    return {
      text: TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE,
      telemetry: {
        foundation: "fake_stub",
        providerId,
        providerOutcome: telemetryOutcomeFromFailedCompletion(result.code),
        provider_phase_ms,
        degraded: true,
      },
    };
  }

  const usageFromOk = result.usage;
  const providerRequestIdFromOk =
    typeof result.providerRequestId === "string" && result.providerRequestId.trim() !== ""
      ? result.providerRequestId.trim()
      : undefined;

  if (providerId === "openai-compatible") {
    return {
      text: result.text,
      telemetry: {
        foundation: "live",
        providerId,
        providerOutcome: "ok",
        provider_phase_ms,
        ...(usageFromOk !== undefined ? { usage: usageFromOk } : {}),
        ...(providerRequestIdFromOk !== undefined
          ? { providerRequestId: providerRequestIdFromOk }
          : {}),
      },
    };
  }

  return {
    text: result.text,
    telemetry: {
      foundation: "fake_stub",
      providerId,
      providerOutcome: "ok",
      provider_phase_ms,
      ...(usageFromOk !== undefined ? { usage: usageFromOk } : {}),
      ...(providerRequestIdFromOk !== undefined
        ? { providerRequestId: providerRequestIdFromOk }
        : {}),
    },
  };
}
