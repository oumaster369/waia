import {
  RESEARCH_QUESTION_SCHEMA_VERSION,
  ResearchQuestionKind,
  type ResearchQuestion,
} from "@/lib/trader/discovery/research-question.types";
import type { ResearchCampaignRef } from "@/lib/trader/discovery/discovery.types";
import type { StructureClusterV2 } from "@/lib/trader/discovery/structure.types";
import { assertValidStructureClusterV2 } from "@/lib/trader/discovery/structure-cluster-contract";
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

function buildQuestionText(input: BuildResearchQuestionInput, cluster: StructureClusterV2): string {
  const { rejectionContext } = input;
  const strategyId = input.strategyId ?? rejectionContext?.recordBody.strategyId;
  const strategyVersion = rejectionContext?.recordBody.strategyVersion;

  if (rejectionContext && strategyId && strategyVersion) {
    return (
      `Under what market conditions does ${strategyId}@${strategyVersion} generate ` +
      `trade-attributed activity in ${cluster.signature.regimeLabel}, and when does signal generation ` +
      "fail to produce closed trades?"
    );
  }

  return (
    `What explains recurring structure signature ${cluster.signature.signatureKey} ` +
    `(regime=${cluster.signature.regimeLabel}, trade_reference_count_band=${cluster.signature.tradeReferenceCountBand}, ` +
    `trade_reference_count=${cluster.signature.tradeCount}) ` +
    "across the pinned observation window?"
  );
}

export function buildResearchQuestion(input: BuildResearchQuestionInput): ResearchQuestion {
  const cluster = assertValidStructureClusterV2(input.cluster);
  const strategyId = input.strategyId ?? input.rejectionContext?.recordBody.strategyId;
  const draft: Omit<ResearchQuestion, "contentDigest"> = {
    schemaVersion: RESEARCH_QUESTION_SCHEMA_VERSION,
    questionId: input.questionId,
    campaignRef: input.campaignRef,
    kind: resolveQuestionKind(cluster, input.rejectionContext),
    questionText: buildQuestionText(input, cluster),
    researchProgram: resolveResearchProgram(strategyId),
    observationRefs: cluster.memberObservationRefs,
    structureClusterRef: cluster.clusterId,
    status: "open",
    createdAt: input.createdAt ?? new Date().toISOString(),
  };

  return {
    ...draft,
    contentDigest: buildResearchQuestionContentDigest(draft),
  };
}
