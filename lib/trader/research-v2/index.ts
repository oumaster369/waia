export {
  RESEARCH_V2_BANNED_DISCOVERY_FIELDS,
  RESEARCH_V2_DIGEST_HEX,
  StrategyEvolutionResearchError,
  assertResearchDiscoveryFitnessV2,
  requireResearchV2Decimal,
  requireResearchV2DigestHex,
  requireResearchV2IsoUtc,
  requireResearchV2NonEmpty,
  uniqueSortedReasonCodes,
} from "@/lib/trader/research-v2/research-v2-guards";

export {
  CLOSED_TRADE_OUTCOME_EVIDENCE_PACKAGE_V2_SCHEMA,
  CLOSED_TRADE_OUTCOME_POLARITIES_V2,
  CLOSED_TRADE_OUTCOME_STATUSES_V2,
  buildClosedTradeOutcomeEvidencePackageV2,
  discardLosingOutcomesFromEvidencePackageV2,
} from "@/lib/trader/research-v2/closed-trade-outcome-evidence-v2";
export type {
  BuildClosedTradeOutcomeEvidencePackageV2Input,
  ClosedTradeOutcomeEvidencePackageV2,
  ClosedTradeOutcomeInputV2,
  ClosedTradeOutcomePolarityV2,
  ClosedTradeOutcomeRecordV2,
  ClosedTradeOutcomeStatusV2,
} from "@/lib/trader/research-v2/closed-trade-outcome-evidence-v2";

export {
  RESEARCH_MEMORY_V2_SCHEMA,
  appendResearchMemoryV2,
  assertResearchMemoryRetainsPackageV2,
  filterResearchMemoryByProfitabilityV2,
  queryContradictingResearchMemoryV2,
  resumeResearchMemoryV2,
} from "@/lib/trader/research-v2/research-memory-v2";
export type { ResearchMemoryV2 } from "@/lib/trader/research-v2/research-memory-v2";

export {
  FALSIFIABLE_HYPOTHESIS_V2_SCHEMA,
  RESEARCH_QUESTION_V2_SCHEMA,
  buildFalsifiableHypothesisV2,
  buildResearchQuestionV2,
} from "@/lib/trader/research-v2/research-question-hypothesis-v2";
export type {
  FalsifiableHypothesisV2,
  ResearchQuestionV2,
} from "@/lib/trader/research-v2/research-question-hypothesis-v2";

export {
  FORBIDDEN_RESEARCH_TEMPLATE_STRATEGY_ID_V2,
  STRATEGY_CANDIDATE_GENERATION_KINDS_V2,
  STRATEGY_EVOLUTION_CANDIDATE_V2_SCHEMA,
  STRATEGY_EVOLUTION_GENERATOR_VERSION_V2,
  assertResearchStrategyIdentityAllowedV2,
  assignStrategyCandidateToAccountV2,
  generateStrategyEvolutionCandidateV2,
  promoteStrategyCandidateV2,
} from "@/lib/trader/research-v2/strategy-candidate-generation-v2";
export type {
  GenerateStrategyEvolutionCandidateV2Input,
  StrategyCandidateGenerationKindV2,
  StrategyCandidateLineageV2,
  StrategyEvolutionCandidateV2,
  StrategyParentRefV2,
} from "@/lib/trader/research-v2/strategy-candidate-generation-v2";

export { deriveStrategyEvolutionGenerationV2 } from "@/lib/trader/research-v2/strategy-candidate-generation-derive-v2";
export type {
  DeriveStrategyEvolutionGenerationV2Input,
  DerivedStrategyEvolutionGenerationV2,
} from "@/lib/trader/research-v2/strategy-candidate-generation-derive-v2";

export {
  QUALIFICATION_PARTITIONS_V2,
  QUALIFICATION_RECORD_V2_SCHEMA,
  QUALIFICATION_VERDICTS_V2,
  assertQualificationPartitionsIndependentV2,
  queryBlindHoldoutAsIterativeFitnessV2,
  recordQualificationV2,
  recordRejectedCandidateV2,
  rerecordRejectedCandidateAsPromotedV2,
} from "@/lib/trader/research-v2/qualification-records-v2";
export type {
  QualificationEvaluationV2,
  QualificationPartitionV2,
  QualificationRecordV2,
  QualificationVerdictV2,
  RejectedCandidateRecordV2,
} from "@/lib/trader/research-v2/qualification-records-v2";

export {
  HUMAN_PROMOTION_PROPOSAL_V2_SCHEMA,
  buildHumanPromotionProposalV2,
} from "@/lib/trader/research-v2/human-promotion-proposal-v2";
export type { HumanPromotionProposalV2 } from "@/lib/trader/research-v2/human-promotion-proposal-v2";

export {
  HUMAN_RESEARCH_ASSIGNMENT_LIFECYCLES_V2,
  HUMAN_RESEARCH_ASSIGNMENT_V2_SCHEMA,
  admitHumanResearchCandidateAssignmentV2,
  mergeHumanResearchAssignmentsV2,
} from "@/lib/trader/research-v2/human-research-assignment-v2";
export type {
  AdmitHumanResearchCandidateAssignmentV2Input,
  HumanResearchAssignmentLifecycleV2,
  HumanResearchAssignmentV2,
  ResearchAccountRefV2,
} from "@/lib/trader/research-v2/human-research-assignment-v2";

export {
  CAPITAL_RUNTIME_CLASSES_V2,
  RESEARCH_JOB_CLASS_V2,
  RESEARCH_JOB_STATUSES_V2,
  RESEARCH_JOB_V2_SCHEMA,
  assertResearchJobCannotClaimCapitalRuntimeV2,
  completeResearchJobV2,
  enqueueResearchJobV2,
} from "@/lib/trader/research-v2/research-job-v2";
export type {
  CapitalRuntimeClassV2,
  EnqueueResearchJobV2Input,
  ResearchJobStatusV2,
  ResearchJobV2,
} from "@/lib/trader/research-v2/research-job-v2";

export {
  RESEARCH_RETIREMENT_PROPOSAL_V2_SCHEMA,
  buildResearchRetirementProposalV2,
} from "@/lib/trader/research-v2/research-retirement-proposal-v2";
export type { ResearchRetirementProposalV2 } from "@/lib/trader/research-v2/research-retirement-proposal-v2";

export {
  STRATEGY_EVOLUTION_KNOWLEDGE_ADMISSION_V2_SCHEMA,
  admitStrategyEvolutionKnowledgeV2,
} from "@/lib/trader/research-v2/strategy-evolution-knowledge-admission-v2";
export type {
  AdmitStrategyEvolutionKnowledgeV2Input,
  StrategyEvolutionKnowledgeAdmissionV2,
} from "@/lib/trader/research-v2/strategy-evolution-knowledge-admission-v2";

export {
  STRATEGY_EVOLUTION_LOOP_V2_SCHEMA,
  runStrategyEvolutionResearchPassV2,
} from "@/lib/trader/research-v2/strategy-evolution-loop-v2";
export type {
  RunStrategyEvolutionResearchPassV2Input,
  StrategyEvolutionLoopStatusV2,
  StrategyEvolutionResearchPassV2,
} from "@/lib/trader/research-v2/strategy-evolution-loop-v2";

export {
  RESEARCH_V2_FORBIDDEN_CONNECTOR_DISPATCH,
  RESEARCH_V2_FORBIDDEN_IMPORT_PREFIXES,
  RESEARCH_V2_MODULE_ROOT,
  researchV2SourceHasForbiddenVenueWrite,
} from "@/lib/trader/research-v2/research-v2-consumer-inventory";
