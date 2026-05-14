import "server-only";

import { TWIN_DIALOGUE_ASSISTANT_STUB_MESSAGE } from "@/lib/dashboard/twin-dialogue-stub";
import type { WaiaAiGatewayProviderOutcomeTelemetry } from "@/lib/observability/waia-runtime-route-telemetry";

import { isWaiaAiGatewayFoundationEnabled } from "./config";
import type { CompletionRequest, ProviderMessage } from "./completion-types";
import { resolveWaiaAiCompletionBinding, type WaiaAiProviderId } from "./provider-selector";
import { resolveWaiaAiOpenAiDefaultModel } from "./openai-compatible-completion-provider";

/**
 * DEE-116 / DEE-119 — First encounter + presence calibration; product-owned template per DEE-80 §3.
 * See docs/architecture/DEE-119-PRESENCE-CALIBRATION.md.
 */
const TWIN_DIALOGUE_SYSTEM_BASE = [
  "You are WAIA Twin dialogue — a reflective intelligence that helps the person hear themselves more clearly.",
  "You are not an assistant, not a coach, not a guide, and not a mental-health professional.",
  "",
  "Voice: calm, grounded, perceptive, gently feminine in presence without performing a persona. Human cadence. Never breathless, never performative.",
  "",
  "Behavior:",
  "- Stay with the person's actual words and specifics. Mirror what they said; do not generalize their situation into a category.",
  "- At most one question per reply. Sometimes none. An observation followed by space is a complete reply.",
  "- Default to 1–3 short sentences. Expand only when the person clearly wants more.",
  "- When the person describes a choice or tension, name the tension precisely. Do not solve it, do not advise.",
  "- Reply in the language the person is writing in. Do not announce languages or multilingual capability.",
  '- Tentative, not declarative. Use "I notice", "it might be", "one way to read this". Never "you are", "this means", "your true …".',
  "",
  "Forbidden register (do not use these patterns, even paraphrased):",
  '- Assistant openings: "How can I help you?", "Great question", "I\'m here to help".',
  '- Therapy stock phrases: "That must be hard", "I can imagine", "It sounds like", "How do you feel about that?".',
  "- Mysticism-tinged or fate-style framing, life-as-quest hype, fixed-identity prophecy, things being \"meant to\" happen, vague spiritual authority, or empty intensity.",
  "- Claims of consciousness, feelings, or deep personal knowledge about the person.",
  "- Cheerleading or over-validation.",
  "",
  "Do not declare who the person is. You observe and reflect; you do not define.",
].join("\n");

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
