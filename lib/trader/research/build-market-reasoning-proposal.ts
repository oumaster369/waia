import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type {
  MarketReasoningProposal,
  MarketReasoningProposalDraft,
} from "@/lib/trader/research/market-reasoning-proposal.types";
import { MARKET_REASONING_PROPOSAL_SCHEMA_VERSION } from "@/lib/trader/research/market-reasoning-proposal.types";
import type { ReasoningContext } from "@/lib/trader/research/reasoning-context.types";
import { buildHypothesisDefinitionForProposal } from "@/lib/trader/research/evolution-cycle-mvp.types";
import {
  computeMarketReasoningOutputDigest,
  computeMarketReasoningProposalDigest,
  computeMarketReasoningPromptDigest,
} from "@/lib/trader/research/serialize-market-reasoning-proposal";
import type { TraderAiFoundationBinding } from "@/lib/ai-gateway/trader-foundation-profile";

export type BuildMarketReasoningProposalInput = {
  context: ReasoningContext;
  draft: MarketReasoningProposalDraft;
  promptMessages: readonly { role: string; content: string }[];
  rawProviderJson: unknown;
  foundation: TraderAiFoundationBinding;
  providerRequestId?: string;
  completedAt?: string;
};

export function buildMarketReasoningProposal(
  input: BuildMarketReasoningProposalInput,
): MarketReasoningProposal {
  const { context, draft, foundation } = input;
  const rejection = context.contextBody.rejectionRecord.recordBody;
  const completedAt = input.completedAt ?? new Date().toISOString();

  const proposalBody = {
    inputArtifactDigests: {
      rejectionRecord: context.envelope.sourceArtifactDigests.rejectionRecord,
      evolutionCycle: context.envelope.sourceArtifactDigests.evolutionCycle,
      reasoningContext: context.envelope.contentDigest,
    },
    reasoningSummary: draft.reasoningSummary,
    marketExplanation: draft.marketExplanation,
    alternativeHypotheses: draft.alternativeHypotheses,
    recommendedNextHypothesis: draft.recommendedNextHypothesis,
    overfittingWarnings: draft.overfittingWarnings,
    confidenceLevel: draft.confidenceLevel,
    humanReview: draft.humanReview,
    providerMetadata: {
      foundationProfile: "ai-trader" as const,
      agentId: "market-reasoning-assist" as const,
      providerId: foundation.providerId,
      model: foundation.model,
      ...(input.providerRequestId !== undefined
        ? { providerRequestId: input.providerRequestId }
        : {}),
      completedAt,
    },
    promptDigest: computeMarketReasoningPromptDigest(input.promptMessages),
    reasoningOutputDigest: computeMarketReasoningOutputDigest(input.rawProviderJson),
  };

  const contentDigest = computeMarketReasoningProposalDigest(proposalBody);

  return {
    schemaVersion: MARKET_REASONING_PROPOSAL_SCHEMA_VERSION,
    envelope: {
      organizationId: rejection.organizationId,
      strategyId: rejection.strategyId,
      strategyVersion: rejection.strategyVersion,
      candidateId: rejection.candidateId,
      contentDigest,
    },
    proposalBody,
  };
}

export function buildFakeMarketReasoningProposalDraft(
  context: ReasoningContext,
): MarketReasoningProposalDraft {
  const rejection = context.contextBody.rejectionRecord.recordBody;
  const strategyId = rejection.strategyId;
  const strategyVersion = rejection.strategyVersion;

  const definition = buildHypothesisDefinitionForProposal({
    strategyId,
    strategyVersion,
    candidateId: rejection.candidateId,
    missingBuckets: rejection.missingBuckets,
  });

  return {
    reasoningSummary:
      `Rejection ${rejection.failureCode} for ${strategyId}@${strategyVersion} shows zero trade-attributed ` +
      "regime coverage across validation replay. The deterministic evolution template identifies missing down-regime " +
      "and non-trending buckets; AI assist adds market-structure context for human review.",
    marketExplanation:
      "Mean-reversion z-score signals on BTC/USDT 1m may remain neutral or fail risk gates during bear/stress/chop " +
      "windows when volatility compresses or trend persistence dominates. With tradeCount=0 and empty byRegime slices, " +
      "the strategy likely never produced closed attributed trades in required regime buckets — consistent with " +
      "MULTI_REGIME_COVERAGE_INSUFFICIENT rather than positive blind evidence.",
    alternativeHypotheses: [
      {
        claimText: `${strategyId} requires explicit CHOP/RANGE regime confirmation before entries; without it, signal density is too sparse for coverage.`,
        rationale:
          "Missing non_trending bucket may reflect absent range-bound mean-reversion opportunities rather than data gaps alone.",
        intendedRegimeScope: ["CHOP", "RANGE"],
      },
      {
        claimText: `${strategyId} down-regime entries need wider z-score bands and longer half-life in TREND_BEAR/STRESS.`,
        rationale:
          "Bear/stress segments may need different calibration than the validation template assumes.",
        intendedRegimeScope: ["TREND_BEAR", "STRESS"],
      },
    ],
    recommendedNextHypothesis: {
      claimText: `${strategyId} entries gated on confirmed TREND_BEAR/STRESS with minimum hold bars produce positive net attribution after modeled costs.`,
      falsificationConditions: [...definition.falsificationConditions],
      intendedRegimeScope: ["TREND_BEAR", "STRESS"],
      mapsToMiRegisterHypothesisDraft: {
        hypothesisKind: "market_claim",
        name: `${strategyId} down-regime attribution v-next (AI assist)`,
        definition,
        supersedes: [],
        authoredBy: "market-reasoning-assist",
      },
    },
    overfittingWarnings: [
      "Zero-trade validation replay may reflect in-memory risk-limit configuration during reconstruction, not only market structure.",
      "Do not treat AI narrative as evidence; only sealed digests and deterministic metrics are authoritative.",
    ],
    confidenceLevel: "medium",
    humanReview: {
      disposition: "pending",
      reviewChecklist: [
        "Verify AI reasoning cites rejection and evolution digests only.",
        "Compare recommended hypothesis against deterministic evolution-cycle MVP template.",
        "Confirm falsification conditions before MI hypothesis registration.",
        "Decide Accept / Defer / Reject — no automatic campaign execution.",
      ],
      nextSteps: [
        "Review market-reasoning-proposal.json alongside evolution-cycle-mvp.json.",
        "If accepted: register hypothesis via existing MI tooling manually.",
        "Register a new strategy candidate version manually.",
        "Schedule the next RI campaign manually when ready.",
      ],
    },
  };
}

export function buildFakeMarketReasoningProviderJson(context: ReasoningContext): unknown {
  return buildFakeMarketReasoningProposalDraft(context);
}
