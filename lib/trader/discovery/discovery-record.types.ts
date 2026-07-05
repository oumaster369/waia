export type ResearchCampaignRow = {
  id: string;
  organizationId: string;
  campaignKey: string;
  name: string;
  researchProgram: string;
  description: string;
  symbolScope: string;
  datasetDigest: string | null;
  currentState: string;
  contentDigest: string;
  createdAt: Date;
};

export type InsertResearchCampaignRow = Omit<ResearchCampaignRow, "createdAt"> & {
  createdAt?: Date;
};

export type ResearchCampaignStateRecordRow = {
  id: string;
  organizationId: string;
  campaignId: string;
  priorState: string | null;
  newState: string;
  rationale: string;
  operatorAttestationDigest: string;
  contentDigest: string;
  createdAt: Date;
};

export type InsertResearchCampaignStateRecordRow = Omit<
  ResearchCampaignStateRecordRow,
  "createdAt"
> & { createdAt?: Date };

export type ResearchQuestionRow = {
  id: string;
  organizationId: string;
  campaignId: string;
  kind: string;
  questionText: string;
  researchProgram: string;
  observationRefsJson: string;
  structureClusterId: string | null;
  status: string;
  contentDigest: string;
  createdAt: Date;
};

export type InsertResearchQuestionRow = Omit<ResearchQuestionRow, "createdAt"> & {
  createdAt?: Date;
};

export type ObservationRow = {
  id: string;
  organizationId: string;
  campaignId: string;
  payloadJson: string;
  contentDigest: string;
  createdAt: Date;
};

export type InsertObservationRow = Omit<ObservationRow, "createdAt"> & { createdAt?: Date };

export type StructureClusterRow = {
  id: string;
  organizationId: string;
  campaignId: string;
  signatureKey: string;
  payloadJson: string;
  contentDigest: string;
  createdAt: Date;
};

export type InsertStructureClusterRow = Omit<StructureClusterRow, "createdAt"> & {
  createdAt?: Date;
};

export type HypothesisProposalRow = {
  id: string;
  organizationId: string;
  campaignId: string;
  researchQuestionId: string;
  payloadJson: string;
  contentDigest: string;
  createdAt: Date;
};

export type InsertHypothesisProposalRow = Omit<HypothesisProposalRow, "createdAt"> & {
  createdAt?: Date;
};

export type ConsolidationRecordRow = {
  id: string;
  organizationId: string;
  campaignId: string;
  action: string;
  sourceRefsJson: string;
  canonicalRef: string | null;
  rationale: string;
  operatorAttestationDigest: string;
  contentDigest: string;
  createdAt: Date;
};

export type InsertConsolidationRecordRow = Omit<ConsolidationRecordRow, "createdAt"> & {
  createdAt?: Date;
};

export type StrategySynthesisRow = {
  id: string;
  organizationId: string;
  campaignId: string;
  strategyId: string;
  strategyVersion: string;
  templateId: string;
  paramsJson: string;
  parentStrategyVersion: string | null;
  hypothesisProposalId: string | null;
  contentDigest: string;
  createdAt: Date;
};

export type InsertStrategySynthesisRow = Omit<StrategySynthesisRow, "createdAt"> & {
  createdAt?: Date;
};

export type EvidenceRecordRow = {
  id: string;
  organizationId: string;
  campaignId: string;
  hypothesisRef: string | null;
  candidateRef: string | null;
  dimension: string;
  direction: string;
  strength: string;
  uncertaintyBandLow: string;
  uncertaintyBandHigh: string;
  contradictionRefsJson: string;
  sourceRunDigest: string;
  relevanceScore: string;
  rationaleJson: string;
  contentDigest: string;
  createdAt: Date;
};

export type InsertEvidenceRecordRow = Omit<EvidenceRecordRow, "createdAt"> & {
  createdAt?: Date;
};

export type ComparisonScoreRow = {
  id: string;
  organizationId: string;
  campaignId: string;
  candidateRef: string;
  dimensionScoresJson: string;
  aggregateRankScore: string;
  contentDigest: string;
  createdAt: Date;
};

export type InsertComparisonScoreRow = Omit<ComparisonScoreRow, "createdAt"> & {
  createdAt?: Date;
};

export type PromotionProposalRow = {
  id: string;
  organizationId: string;
  campaignId: string;
  candidateId: string;
  comparisonDigest: string;
  recommends: string;
  rationale: string;
  contentDigest: string;
  createdAt: Date;
};

export type InsertPromotionProposalRow = Omit<PromotionProposalRow, "createdAt"> & {
  createdAt?: Date;
};

export type RetirementRecordRow = {
  id: string;
  organizationId: string;
  campaignId: string;
  subjectRef: string;
  subjectKind: string;
  rationale: string;
  operatorAttestationDigest: string;
  contentDigest: string;
  createdAt: Date;
};

export type InsertRetirementRecordRow = Omit<RetirementRecordRow, "createdAt"> & {
  createdAt?: Date;
};

export type DiscoveryRegistryRow =
  | ResearchCampaignRow
  | ResearchCampaignStateRecordRow
  | ResearchQuestionRow
  | ObservationRow
  | StructureClusterRow
  | HypothesisProposalRow
  | ConsolidationRecordRow
  | StrategySynthesisRow
  | EvidenceRecordRow
  | ComparisonScoreRow
  | PromotionProposalRow
  | RetirementRecordRow;
