import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { buildFakeMarketReasoningProviderJson } from "@/lib/trader/research/build-market-reasoning-proposal";
import { buildMarketReasoningPrompt } from "@/lib/trader/research/build-market-reasoning-prompt";
import { MarketReasoningAssistError } from "@/lib/trader/research/errors";
import type {
  ResearchReasoningAgentPort,
  ResearchReasoningAgentResult,
} from "@/lib/trader/research/research-reasoning-agent.types";
import type { ReasoningContext } from "@/lib/trader/research/reasoning-context.types";
import {
  parseProviderJsonText,
  validateMarketReasoningGuardrails,
} from "@/lib/trader/research/validate-market-reasoning-guardrails";

export class MarketReasoningAssistAgent implements ResearchReasoningAgentPort {
  readonly agentId = "market-reasoning-assist" as const;

  async run(input: {
    context: ReasoningContext;
    foundation: import("@/lib/ai-gateway/trader-foundation-profile").TraderAiFoundationBinding;
    signal?: AbortSignal;
  }): Promise<ResearchReasoningAgentResult> {
    const { context, foundation, signal } = input;
    const prompt = buildMarketReasoningPrompt(context);

    if (foundation.providerId === "fake") {
      const rawProviderJson = buildFakeMarketReasoningProviderJson(context);
      try {
        const proposalDraft = validateMarketReasoningGuardrails({
          rawProviderJson,
          expectedInputDigests: {
            rejectionRecord: context.envelope.sourceArtifactDigests.rejectionRecord,
            evolutionCycle: context.envelope.sourceArtifactDigests.evolutionCycle,
            reasoningContext: context.envelope.contentDigest,
          },
        });
        return { ok: true, rawProviderJson, proposalDraft };
      } catch (error) {
        return {
          ok: false,
          code: "GUARDRAIL_REJECTED",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const completion = await foundation.provider.complete(
      {
        model: foundation.model,
        messages: prompt.all,
        maxOutputTokens: 2048,
        temperature: 0,
      },
      signal,
    );

    if (!completion.ok) {
      return {
        ok: false,
        code: "PROVIDER_ERROR",
        message: `provider completion failed: ${completion.code}`,
      };
    }

    let rawProviderJson: unknown;
    try {
      rawProviderJson = parseProviderJsonText(completion.text);
    } catch (error) {
      return {
        ok: false,
        code: "PARSE_ERROR",
        message: error instanceof Error ? error.message : "failed to parse provider JSON",
      };
    }

    try {
      const proposalDraft = validateMarketReasoningGuardrails({
        rawProviderJson,
        expectedInputDigests: {
          rejectionRecord: context.envelope.sourceArtifactDigests.rejectionRecord,
          evolutionCycle: context.envelope.sourceArtifactDigests.evolutionCycle,
          reasoningContext: context.envelope.contentDigest,
        },
      });
      return {
        ok: true,
        rawProviderJson,
        proposalDraft,
        providerRequestId: completion.providerRequestId,
      };
    } catch (error) {
      return {
        ok: false,
        code: "GUARDRAIL_REJECTED",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export const marketReasoningAssistAgent = new MarketReasoningAssistAgent();

export const RESEARCH_REASONING_AGENTS: Record<
  "market-reasoning-assist",
  ResearchReasoningAgentPort
> = {
  "market-reasoning-assist": marketReasoningAssistAgent,
};

export function resolveResearchReasoningAgent(
  agentId: "market-reasoning-assist",
): ResearchReasoningAgentPort {
  const agent = RESEARCH_REASONING_AGENTS[agentId];
  if (!agent) {
    throw new MarketReasoningAssistError(
      "UNKNOWN_AGENT",
      `unknown research reasoning agent: ${agentId}`,
    );
  }
  return agent;
}
