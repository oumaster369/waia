import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { ProviderMessage } from "@/lib/ai-gateway/completion-types";
import type { ReasoningContext } from "@/lib/trader/research/reasoning-context.types";

export const MARKET_REASONING_PROMPT_VERSION = "market-reasoning-assist-prompt-v1" as const;

const SYSTEM_PROMPT = `You are the WAIA AI-TRADER market reasoning assist agent (recommend-only).

Your role is to analyze research rejection evidence and propose improved market hypotheses.

STRICT BOUNDARIES (ADR-0019):
- Recommend only. Never instruct promotion, live trading, paper trading, or capital allocation.
- Never instruct running campaigns, registering hypotheses, or registering strategy candidates.
- Never include shell commands, pnpm/npm instructions, or executable steps.
- Output JSON only matching the requested schema.
- humanReview.disposition must be exactly "pending".
- Include at least two falsification conditions for the recommended hypothesis.
- Provide 1-5 alternative hypotheses with rationale grounded in the evidence.`;

export type MarketReasoningPromptMessages = {
  system: ProviderMessage;
  user: ProviderMessage;
  all: ProviderMessage[];
};

export function buildMarketReasoningPrompt(
  context: ReasoningContext,
): MarketReasoningPromptMessages {
  const rejection = context.contextBody.rejectionRecord.recordBody;
  const evolution = context.contextBody.evolutionCycle.cycleBody;

  const evidencePayload = {
    failureCode: rejection.failureCode,
    failureMessage: rejection.failureMessage,
    observedRegimes: rejection.observedRegimes,
    missingBuckets: rejection.missingBuckets,
    validationMetrics: rejection.validationMetrics,
    walkForwardWindowCount: rejection.walkForwardWindowCount,
    blindConsumed: rejection.blindConsumed,
    deterministicResearchQuestion: evolution.researchQuestion.questionText,
    deterministicKnowledgeNeed: evolution.knowledgeNeed.statement,
    deterministicHypothesisClaim: evolution.hypothesisProposal.claimText,
    sourceRejectionDigest: context.envelope.sourceArtifactDigests.rejectionRecord,
    sourceEvolutionDigest: context.envelope.sourceArtifactDigests.evolutionCycle,
    reasoningContextDigest: context.envelope.contentDigest,
  };

  const userContent = `Analyze the following research rejection evidence and return JSON with this exact shape:
{
  "reasoningSummary": "string (max 2000 chars)",
  "marketExplanation": "string (max 4000 chars)",
  "alternativeHypotheses": [
    { "claimText": "string", "rationale": "string", "intendedRegimeScope": ["TREND_BEAR", "STRESS"] }
  ],
  "recommendedNextHypothesis": {
    "claimText": "string",
    "falsificationConditions": ["string", "string"],
    "intendedRegimeScope": ["TREND_BEAR", "STRESS"],
    "mapsToMiRegisterHypothesisDraft": {
      "hypothesisKind": "market_claim",
      "name": "string",
      "definition": { /* HypothesisDefinition compatible object */ },
      "supersedes": [],
      "authoredBy": "market-reasoning-assist"
    }
  },
  "overfittingWarnings": ["string"],
  "confidenceLevel": "low" | "medium" | "high",
  "humanReview": {
    "disposition": "pending",
    "reviewChecklist": ["string"],
    "nextSteps": ["string"]
  }
}

Evidence:
${JSON.stringify(evidencePayload, null, 2)}`;

  const system: ProviderMessage = { role: "system", content: SYSTEM_PROMPT };
  const user: ProviderMessage = { role: "user", content: userContent };

  return { system, user, all: [system, user] };
}
