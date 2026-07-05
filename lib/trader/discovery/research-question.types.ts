import type { ResearchCampaignRef } from "@/lib/trader/discovery/discovery.types";

export const RESEARCH_QUESTION_SCHEMA_VERSION =
  "waia.trader.discovery-research-question.v1" as const;

export enum ResearchQuestionKind {
  UnansweredMarketQuestion = "unanswered_market_question",
  Anomaly = "anomaly",
  Inconsistency = "inconsistency",
  UnexplainedObservation = "unexplained_observation",
  ResearchObjective = "research_objective",
}

export const RESEARCH_QUESTION_STATUS_VALUES = [
  "open",
  "hypotheses_pending",
  "experiments_running",
  "consolidated",
] as const;

export type ResearchQuestionStatus = (typeof RESEARCH_QUESTION_STATUS_VALUES)[number];

export type ResearchQuestion = {
  schemaVersion: typeof RESEARCH_QUESTION_SCHEMA_VERSION;
  questionId: string;
  campaignRef: ResearchCampaignRef;
  kind: ResearchQuestionKind;
  questionText: string;
  researchProgram: string;
  observationRefs: readonly string[];
  structureClusterRef: string | null;
  status: ResearchQuestionStatus;
  contentDigest: string;
  createdAt: string;
};
