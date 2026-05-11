import "server-only";

import { TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE } from "@/lib/dashboard/twin-dialogue-stub";
import type { WaiaAiGatewayProviderOutcomeTelemetry } from "@/lib/observability/waia-runtime-route-telemetry";

import { isWaiaAiGatewayFoundationEnabled } from "./config";
import type { CompletionRequest } from "./completion-types";
import { resolveWaiaAiCompletionBinding, type WaiaAiProviderId } from "./provider-selector";
import { resolveWaiaAiOpenAiDefaultModel } from "./openai-compatible-completion-provider";

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
): CompletionRequest {
  if (providerId === "fake") {
    return {
      model: "fake/no-network",
      messages: [
        {
          role: "system",
          content:
            "WAIA Twin dialogue foundation layer — no external inference in this deployment slice.",
        },
        { role: "user", content: userContent },
      ],
      maxOutputTokens: 256,
      temperature: 0,
    };
  }

  return {
    model: resolveWaiaAiOpenAiDefaultModel(),
    messages: [
      {
        role: "system",
        content:
          "WAIA Twin dialogue — AI-Twin training assistant. Be concise, dialogical, and supportive.",
      },
      { role: "user", content: userContent },
    ],
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

  const { providerId, provider } = resolveWaiaAiCompletionBinding();
  const request = buildTwinDialogueCompletionRequest(input.userContent, providerId);

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
      ...(providerRequestIdFromOk !== undefined ? { providerRequestId: providerRequestIdFromOk } : {}),
    },
  };
}
