import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import type { ResearchCampaignCharter } from "@/lib/trader/discovery/research-campaign.types";
import type { ObservationRecord } from "@/lib/trader/discovery/observation.types";
import type { StructureCluster } from "@/lib/trader/discovery/structure.types";
import type { ResearchQuestion } from "@/lib/trader/discovery/research-question.types";
import type { HypothesisProposalArtifact } from "@/lib/trader/discovery/hypothesis-proposal.types";
import type { EpistemicEvidenceRecord } from "@/lib/trader/discovery/evidence.types";
import type {
  ComparisonScore,
  PromotionProposalArtifact,
} from "@/lib/trader/discovery/comparison.types";
import type { ConsolidationRecord } from "@/lib/trader/discovery/knowledge-consolidation.types";

export function buildResearchCampaignContentDigest(input: {
  organizationId: string;
  charter: ResearchCampaignCharter;
}): string {
  return createHash("sha256")
    .update(
      canonicalJsonString({
        organizationId: input.organizationId,
        charter: input.charter,
      }),
      "utf8",
    )
    .digest("hex");
}

export function buildCampaignStateContentDigest(input: {
  organizationId: string;
  campaignId: string;
  priorState: string | null;
  newState: string;
  rationale: string;
  operatorAttestationDigest: string;
}): string {
  return createHash("sha256").update(canonicalJsonString(input), "utf8").digest("hex");
}

export function buildObservationContentDigest(
  observation: Omit<ObservationRecord, "contentDigest">,
): string {
  return createHash("sha256")
    .update(
      canonicalJsonString({
        observationId: observation.observationId,
        campaignRef: observation.campaignRef,
        barWindow: observation.barWindow,
        observedRegimes: observation.observedRegimes,
        tradeRefs: observation.tradeRefs,
        patternRefs: observation.patternRefs,
        eventRefs: observation.eventRefs,
      }),
      "utf8",
    )
    .digest("hex");
}

export function buildStructureClusterContentDigest(
  cluster: Omit<StructureCluster, "contentDigest">,
): string {
  return createHash("sha256")
    .update(
      canonicalJsonString({
        clusterId: cluster.clusterId,
        campaignRef: cluster.campaignRef,
        signature: cluster.signature,
        memberObservationRefs: cluster.memberObservationRefs,
      }),
      "utf8",
    )
    .digest("hex");
}

export function buildResearchQuestionContentDigest(
  question: Omit<ResearchQuestion, "contentDigest">,
): string {
  return createHash("sha256")
    .update(
      canonicalJsonString({
        questionId: question.questionId,
        campaignRef: question.campaignRef,
        kind: question.kind,
        questionText: question.questionText,
        researchProgram: question.researchProgram,
        observationRefs: question.observationRefs,
        structureClusterRef: question.structureClusterRef,
        status: question.status,
      }),
      "utf8",
    )
    .digest("hex");
}

export function buildHypothesisProposalContentDigest(
  proposal: Omit<HypothesisProposalArtifact, "contentDigest">,
): string {
  return createHash("sha256")
    .update(
      canonicalJsonString({
        proposalId: proposal.proposalId,
        organizationId: proposal.organizationId,
        campaignId: proposal.campaignId,
        researchQuestionRef: proposal.researchQuestionRef,
        claimText: proposal.claimText,
        falsificationConditions: proposal.falsificationConditions,
        intendedRegimeScope: proposal.intendedRegimeScope,
        lineage: proposal.lineage,
        mapsToMiRegisterHypothesis: proposal.mapsToMiRegisterHypothesis,
      }),
      "utf8",
    )
    .digest("hex");
}

export function buildStrategySynthesisContentDigest(input: {
  organizationId: string;
  campaignId: string;
  strategyId: string;
  strategyVersion: string;
  templateId: string;
  paramsJson: string;
  parentStrategyVersion: string | null;
}): string {
  return createHash("sha256").update(canonicalJsonString(input), "utf8").digest("hex");
}

export function buildEvidenceRecordContentDigest(
  record: Omit<EpistemicEvidenceRecord, "contentDigest">,
): string {
  return createHash("sha256")
    .update(
      canonicalJsonString({
        evidenceId: record.evidenceId,
        organizationId: record.organizationId,
        campaignId: record.campaignId,
        hypothesisRef: record.hypothesisRef,
        candidateRef: record.candidateRef,
        dimension: record.dimension,
        direction: record.direction,
        strength: record.strength,
        uncertaintyBandLow: record.uncertaintyBandLow,
        uncertaintyBandHigh: record.uncertaintyBandHigh,
        contradictionRefs: record.contradictionRefs,
        sourceRunDigest: record.sourceRunDigest,
        relevanceScore: record.relevanceScore,
        rationaleJson: record.rationaleJson,
      }),
      "utf8",
    )
    .digest("hex");
}

export function buildComparisonScoreContentDigest(
  score: Omit<ComparisonScore, "contentDigest">,
): string {
  return createHash("sha256")
    .update(
      canonicalJsonString({
        scoreId: score.scoreId,
        organizationId: score.organizationId,
        campaignId: score.campaignId,
        candidateRef: score.candidateRef,
        dimensionScores: score.dimensionScores,
        aggregateRankScore: score.aggregateRankScore,
      }),
      "utf8",
    )
    .digest("hex");
}

export function buildPromotionProposalContentDigest(
  proposal: Omit<PromotionProposalArtifact, "contentDigest">,
): string {
  return createHash("sha256")
    .update(
      canonicalJsonString({
        proposalId: proposal.proposalId,
        organizationId: proposal.organizationId,
        campaignId: proposal.campaignId,
        candidateId: proposal.candidateId,
        comparisonDigest: proposal.comparisonDigest,
        humanGateRequired: proposal.humanGateRequired,
        recommends: proposal.recommends,
        rationale: proposal.rationale,
      }),
      "utf8",
    )
    .digest("hex");
}

export function buildConsolidationRecordContentDigest(
  record: Omit<ConsolidationRecord, "contentDigest">,
): string {
  return createHash("sha256")
    .update(
      canonicalJsonString({
        id: record.id,
        organizationId: record.organizationId,
        campaignRef: record.campaignRef,
        action: record.action,
        sourceRefs: record.sourceRefs,
        canonicalRef: record.canonicalRef,
        rationale: record.rationale,
        operatorAttestationDigest: record.operatorAttestationDigest,
      }),
      "utf8",
    )
    .digest("hex");
}

export function buildRetirementRecordContentDigest(input: {
  organizationId: string;
  campaignId: string;
  subjectRef: string;
  subjectKind: "hypothesis" | "strategy" | "candidate";
  rationale: string;
  operatorAttestationDigest: string;
}): string {
  return createHash("sha256").update(canonicalJsonString(input), "utf8").digest("hex");
}
