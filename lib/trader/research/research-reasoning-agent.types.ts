import type { TraderAiFoundationBinding } from "@/lib/ai-gateway/trader-foundation-profile";
import type { MarketReasoningProposalDraft } from "@/lib/trader/research/market-reasoning-proposal.types";
import type { ReasoningContext } from "@/lib/trader/research/reasoning-context.types";

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
    }
  | {
      ok: false;
      code: "PROVIDER_ERROR" | "GUARDRAIL_REJECTED" | "PARSE_ERROR";
      message: string;
    };

export interface ResearchReasoningAgentPort {
  readonly agentId: ResearchReasoningAgentId;
  run(input: {
    context: ReasoningContext;
    foundation: TraderAiFoundationBinding;
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
