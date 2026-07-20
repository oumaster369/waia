import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { isTraderReasoningFakePath } from "@/lib/ai-gateway/trader-foundation-profile";
import {
  resolveTraderOpenAiMaxOutputTokens,
  resolveTraderOpenAiTemperature,
} from "@/lib/ai-gateway/trader-openai-compatible-completion-provider";
import { buildFakeMarketReasoningProviderJson } from "@/lib/trader/research/build-market-reasoning-proposal";
import {
  buildMarketReasoningPrompt,
  MARKET_REASONING_PROMPT_VERSION,
} from "@/lib/trader/research/build-market-reasoning-prompt";
import { MarketReasoningAssistError } from "@/lib/trader/research/errors";
import { emptyReasoningMemory } from "@/lib/trader/research/reasoning-memory.types";
import type {
  ResearchReasoningAgentPort,
  ResearchReasoningAgentResult,
} from "@/lib/trader/research/research-reasoning-agent.types";
import type { ReasoningContext } from "@/lib/trader/research/reasoning-context.types";
import {
  computeMarketReasoningOutputDigest,
  computeMarketReasoningPromptDigest,
} from "@/lib/trader/research/serialize-market-reasoning-proposal";
import {
  parseProviderJsonText,
  validateMarketReasoningGuardrails,
} from "@/lib/trader/research/validate-market-reasoning-guardrails";

export class MarketReasoningAssistAgent implements ResearchReasoningAgentPort {
  readonly agentId = "market-reasoning-assist" as const;

  async run(input: {
    context: ReasoningContext;
    memory?: import("@/lib/trader/research/reasoning-memory.types").ReasoningMemory;
    foundation: import("@/lib/ai-gateway/trader-ai-foundation.types").TraderAIFoundationProfile;
    signal?: AbortSignal;
  }): Promise<ResearchReasoningAgentResult> {
    const { context, foundation, signal } = input;
    const memory = input.memory ?? emptyReasoningMemory;
    void memory;
    const prompt = buildMarketReasoningPrompt(context);
    const promptDigest = computeMarketReasoningPromptDigest(prompt.all);
    const expectedInputDigests = {
      rejectionRecord: context.envelope.sourceArtifactDigests.rejectionRecord,
      evolutionCycle: context.envelope.sourceArtifactDigests.evolutionCycle,
      reasoningContext: context.envelope.contentDigest,
    };

    if (isTraderReasoningFakePath(foundation)) {
      const rawProviderJson = buildFakeMarketReasoningProviderJson(context);
      try {
        const proposalDraft = validateMarketReasoningGuardrails({
          rawProviderJson,
          expectedInputDigests,
        });
        return {
          ok: true,
          rawProviderJson,
          proposalDraft,
          retryCount: 0,
          latencyMs: 0,
          promptVersion: MARKET_REASONING_PROMPT_VERSION,
          promptDigest,
          responseDigest: computeMarketReasoningOutputDigest(rawProviderJson),
        };
      } catch (error) {
        return {
          ok: false,
          code: "GUARDRAIL_REJECTED",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const completion = await foundation.reasoningEngine.complete(
      {
        model: foundation.model,
        messages: prompt.all,
        maxOutputTokens: resolveTraderOpenAiMaxOutputTokens(),
        temperature: resolveTraderOpenAiTemperature(),
        outputFormat: "json_object",
      },
      foundation.executionContext,
      signal,
    );

    if (!completion.ok) {
      const agentCode =
        completion.code === "BUDGET_EXCEEDED"
          ? "BUDGET_EXCEEDED"
          : completion.code === "CONFIG"
            ? "CONFIG"
            : "PROVIDER_ERROR";
      return {
        ok: false,
        code: agentCode,
        message: `provider completion failed: ${completion.code}`,
        retryCount: completion.retryCount,
        latencyMs: completion.latencyMs,
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
        retryCount: completion.retryCount,
        latencyMs: completion.latencyMs,
      };
    }

    const responseDigest = computeMarketReasoningOutputDigest(rawProviderJson);

    try {
      const proposalDraft = validateMarketReasoningGuardrails({
        rawProviderJson,
        expectedInputDigests,
      });
      return {
        ok: true,
        rawProviderJson,
        proposalDraft,
        providerRequestId: completion.providerRequestId,
        finishReason: completion.finishReason,
        retryCount: completion.retryCount,
        latencyMs: completion.latencyMs,
        promptVersion: MARKET_REASONING_PROMPT_VERSION,
        promptDigest,
        responseDigest,
        tokenUsage:
          completion.usage !== undefined
            ? {
                prompt: completion.usage.promptTokens,
                completion: completion.usage.completionTokens,
                total: completion.usage.totalTokens,
              }
            : undefined,
      };
    } catch (error) {
      return {
        ok: false,
        code: "GUARDRAIL_REJECTED",
        message: error instanceof Error ? error.message : String(error),
        retryCount: completion.retryCount,
        latencyMs: completion.latencyMs,
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
