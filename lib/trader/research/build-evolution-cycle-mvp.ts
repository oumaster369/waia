import {
  buildHypothesisDefinitionForProposal,
  EVOLUTION_CYCLE_MVP_SCHEMA_VERSION,
  RESEARCH_PROGRAM_BY_STRATEGY,
  type BuildEvolutionCycleMvpInput,
  type EvolutionCycleMvp,
  type EvolutionCycleMvpKnowledgeNeed,
  type KnowledgeNeedType,
} from "@/lib/trader/research/evolution-cycle-mvp.types";
import type { RejectionMissingBucket } from "@/lib/trader/research/research-rejection-record.types";
import type { ResearchRejectionRecord } from "@/lib/trader/research/research-rejection-record.types";
import { computeEvolutionCycleMvpDigest } from "@/lib/trader/research/serialize-evolution-cycle-mvp";
import { campaignOutcomeFromRejectionRecord } from "@/lib/trader/research/finalize-research-campaign-failure";
import type { CampaignOutcomeSnapshot } from "@/lib/trader/research/research-rejection-record.types";

function resolveResearchProgram(strategyId: string): string {
  return RESEARCH_PROGRAM_BY_STRATEGY[strategyId] ?? `${strategyId}_research_program`;
}

function resolveKnowledgeNeedType(
  missingBuckets: readonly RejectionMissingBucket[],
): KnowledgeNeedType {
  if (missingBuckets.includes("down_regime")) {
    return "missing_regime_context";
  }
  if (missingBuckets.includes("non_trending")) {
    return "insufficient_sample";
  }
  return "unresolved_pattern";
}

function buildResearchQuestionText(strategyId: string, strategyVersion: string): string {
  return (
    `Under what market conditions does ${strategyId}@${strategyVersion} generate ` +
    "trade-attributed activity in TREND_BEAR or STRESS, and when does signal generation " +
    "fail to produce closed trades?"
  );
}

function buildKnowledgeNeedStatement(
  strategyId: string,
  strategyVersion: string,
  observedRegimes: readonly string[],
): string {
  const observed = observedRegimes.length > 0 ? observedRegimes.join(", ") : "none";
  return (
    `Bundle regime coverage for ${strategyId}@${strategyVersion} lacks down-regime ` +
    `(TREND_BEAR/STRESS) trade attribution despite observed regimes: ${observed}.`
  );
}

function buildHypothesisClaimText(strategyId: string): string {
  return (
    `${strategyId} entries in TREND_BEAR/STRESS produce positive net attribution when ` +
    "regime gate requires explicit down-regime confirmation and minimum hold bars are satisfied."
  );
}

export function buildEvolutionCycleMvpFromRejection(
  rejectionRecord: ResearchRejectionRecord,
): EvolutionCycleMvp {
  const body = rejectionRecord.recordBody;
  const researchProgram = resolveResearchProgram(body.strategyId);
  const needType = resolveKnowledgeNeedType(body.missingBuckets);
  const rejectionDigest = rejectionRecord.envelope.contentDigest;

  const knowledgeNeed: EvolutionCycleMvpKnowledgeNeed = {
    needType,
    severity: "high",
    statement: buildKnowledgeNeedStatement(
      body.strategyId,
      body.strategyVersion,
      body.observedRegimes,
    ),
    evidenceRefs: [rejectionDigest],
  };

  const hypothesisDefinition = buildHypothesisDefinitionForProposal({
    strategyId: body.strategyId,
    strategyVersion: body.strategyVersion,
    candidateId: body.candidateId,
    missingBuckets: body.missingBuckets,
  });

  const cycleBody = {
    observation: {
      observedRegimes: body.observedRegimes,
      missingBuckets: body.missingBuckets,
      blindConsumed: body.blindConsumed,
      failureCode: body.failureCode,
      candidateId: body.candidateId,
    },
    researchQuestion: {
      questionText: buildResearchQuestionText(body.strategyId, body.strategyVersion),
      researchProgram,
      status: "open" as const,
    },
    knowledgeNeed,
    hypothesisProposal: {
      claimText: buildHypothesisClaimText(body.strategyId),
      falsificationConditions: [...hypothesisDefinition.falsificationConditions],
      intendedRegimeScope: ["TREND_BEAR", "STRESS"],
      lineage: {
        priorCandidateId: body.candidateId,
        priorStrategyId: body.strategyId,
        priorStrategyVersion: body.strategyVersion,
      },
      mapsToMiRegisterHypothesis: {
        hypothesisKind: "market_claim" as const,
        name: `${body.strategyId} down-regime attribution v-next`,
        definition: hypothesisDefinition,
        supersedes: [],
        authoredBy: "strategy-evolution-engine-mvp",
      },
    },
    humanReview: {
      disposition: "pending" as const,
      reviewChecklist: [
        "Verify research question addresses the observed rejection evidence.",
        "Confirm knowledge need cites the rejection record digest.",
        "Review falsification conditions before MI hypothesis registration.",
        "Decide Accept / Defer / Reject — no automatic campaign execution.",
      ],
      nextSteps: [
        "Review hypothesis proposal fields in evolution-cycle-mvp.json.",
        "If accepted: register hypothesis via existing MI tooling.",
        "Register a new strategy candidate version manually.",
        "Schedule the next RI campaign manually (pnpm trader:ri:campaign).",
      ],
    },
  };

  const contentDigest = computeEvolutionCycleMvpDigest(cycleBody);

  return {
    schemaVersion: EVOLUTION_CYCLE_MVP_SCHEMA_VERSION,
    envelope: {
      organizationId: body.organizationId,
      strategyId: body.strategyId,
      strategyVersion: body.strategyVersion,
      sourceOutcomeKind: "rejected",
      sourceRejectionDigest: rejectionDigest,
      contentDigest,
    },
    cycleBody,
  };
}

export function buildEvolutionCycleMvp(input: BuildEvolutionCycleMvpInput): EvolutionCycleMvp {
  return buildEvolutionCycleMvpFromRejection(input.rejectionRecord);
}

export function buildEvolutionCycleMvpFromOutcome(
  outcome: CampaignOutcomeSnapshot,
): EvolutionCycleMvp {
  if (outcome.kind !== "rejected" || !outcome.rejectionRecord) {
    throw new Error(
      "[research] evolution cycle MVP requires a rejected campaign with rejection record",
    );
  }
  return buildEvolutionCycleMvpFromRejection(outcome.rejectionRecord);
}

export { campaignOutcomeFromRejectionRecord };
