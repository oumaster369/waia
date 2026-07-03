import type { TraderAIFoundationProfile } from "@/lib/ai-gateway/trader-ai-foundation.types";
import type { MarketReasoningProposalDraft } from "@/lib/trader/research/market-reasoning-proposal.types";
import type { ReasoningContext } from "@/lib/trader/research/reasoning-context.types";
import type { ReasoningMemory } from "@/lib/trader/research/reasoning-memory.types";

export type ResearchReasoningAgentId =
  | "market-reasoning-assist"
  | "market-analyst"
  | "strategy-scientist"
  | "risk-scientist"
  | "devils-advocate"
  | "evolution-architect";

export type ResearchReasoningAgentResult =
  | {
      ok: true;
      rawProviderJson: unknown;
      proposalDraft: MarketReasoningProposalDraft;
      providerRequestId?: string;
      finishReason?: string;
      retryCount: number;
      latencyMs: number;
      promptVersion: string;
      promptDigest: string;
      responseDigest: string;
      tokenUsage?: { prompt?: number; completion?: number; total?: number };
    }
  | {
      ok: false;
      code: "PROVIDER_ERROR" | "GUARDRAIL_REJECTED" | "PARSE_ERROR" | "BUDGET_EXCEEDED" | "CONFIG";
      message: string;
      retryCount?: number;
      latencyMs?: number;
    };

export interface ResearchReasoningAgentPort {
  readonly agentId: ResearchReasoningAgentId;
  run(input: {
    context: ReasoningContext;
    memory: ReasoningMemory;
    foundation: TraderAIFoundationProfile;
    signal?: AbortSignal;
  }): Promise<ResearchReasoningAgentResult>;
}

export const RESEARCH_REASONING_AGENT_IDS = [
  "market-reasoning-assist",
  "market-analyst",
  "strategy-scientist",
  "risk-scientist",
  "devils-advocate",
  "evolution-architect",
] as const satisfies readonly ResearchReasoningAgentId[];
