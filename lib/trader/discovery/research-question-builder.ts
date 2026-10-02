import {
  RESEARCH_QUESTION_SCHEMA_VERSION,
  ResearchQuestionKind,
  type ResearchQuestion,
} from "@/lib/trader/discovery/research-question.types";
import type { ResearchCampaignRef } from "@/lib/trader/discovery/discovery.types";
import type { StructureClusterV2 } from "@/lib/trader/discovery/structure.types";
import {
  assertValidResearchCampaignRefV2,
  assertValidStructureClusterV2,
} from "@/lib/trader/discovery/structure-cluster-v2";
import { RESEARCH_PROGRAM_BY_STRATEGY } from "@/lib/trader/research/evolution-cycle-mvp.types";
import type { ResearchRejectionRecord } from "@/lib/trader/research/research-rejection-record.types";
import { buildResearchQuestionContentDigest } from "@/lib/trader/discovery/serialize-discovery";

export type BuildResearchQuestionInput = {
  campaignRef: ResearchCampaignRef;
  cluster: StructureClusterV2;
  rejectionContext?: ResearchRejectionRecord | null;
  strategyId?: string;
  questionId: string;
  createdAt?: string;
};

function resolveResearchProgram(strategyId: string | undefined): string {
  if (!strategyId) {
    return "general_market_research_program";
  }
  return RESEARCH_PROGRAM_BY_STRATEGY[strategyId] ?? `${strategyId}_research_program`;
}

function resolveQuestionKind(
  cluster: StructureClusterV2,
  rejectionContext?: ResearchRejectionRecord | null,
): ResearchQuestionKind {
  if (rejectionContext) {
    return ResearchQuestionKind.UnexplainedObservation;
  }
  if (cluster.signature.tradeCount === 0) {
    return ResearchQuestionKind.Anomaly;
  }
  return ResearchQuestionKind.UnansweredMarketQuestion;
}

function buildQuestionText(input: BuildResearchQuestionInput): string {
  const { cluster, rejectionContext } = input;
  const strategyId = input.strategyId ?? rejectionContext?.recordBody.strategyId;
  const strategyVersion = rejectionContext?.recordBody.strategyVersion;

  if (rejectionContext && strategyId && strategyVersion) {
    return (
      `Under what market conditions does ${strategyId}@${strategyVersion} generate ` +
      "trade-attributed activity in TREND_BEAR or STRESS, and when does signal generation " +
      `fail to produce closed trades? (trade-reference count band=${cluster.signature.tradeReferenceCountBand}; ` +
      "measured volatility unavailable.)"
    );
  }

  return (
    `What explains recurring structure signature ${cluster.signature.signatureKey} ` +
    `(regime=${cluster.signature.regimeLabel}, trade-reference count band=${cluster.signature.tradeReferenceCountBand}; ` +
    "measured volatility unavailable) " +
    "across the pinned observation window?"
  );
}

export function buildResearchQuestion(input: BuildResearchQuestionInput): ResearchQuestion {
  assertValidStructureClusterV2(input.cluster);
  assertValidResearchCampaignRefV2(input.campaignRef);
  if (input.campaignRef.campaignId !== input.cluster.campaignRef.campaignId ||
      input.campaignRef.campaignDigest !== input.cluster.campaignRef.campaignDigest ||
      input.campaignRef.state !== input.cluster.campaignRef.state) {
    throw new Error("STRUCTURE_CLUSTER_V2_INVALID:CAMPAIGN_SCOPE");
  }
  const strategyId = input.strategyId ?? input.rejectionContext?.recordBody.strategyId;
  const draft: Omit<ResearchQuestion, "contentDigest"> = {
    schemaVersion: RESEARCH_QUESTION_SCHEMA_VERSION,
    questionId: input.questionId,
    campaignRef: {
      campaignId: input.campaignRef.campaignId,
      campaignDigest: input.campaignRef.campaignDigest,
      state: input.campaignRef.state,
    },
    kind: resolveQuestionKind(input.cluster, input.rejectionContext),
    questionText: buildQuestionText(input),
    researchProgram: resolveResearchProgram(strategyId),
    observationRefs: [...input.cluster.memberObservationRefs],
    structureClusterRef: input.cluster.clusterId,
    status: "open",
    createdAt: input.createdAt ?? new Date().toISOString(),
  };

  return {
    ...draft,
    contentDigest: buildResearchQuestionContentDigest(draft),
  };
}
