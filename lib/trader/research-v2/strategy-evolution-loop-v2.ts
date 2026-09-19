import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { FutureCycleEpistemicEffectReceiptV2 } from "@/lib/trader/knowledge/navigator/future-cycle-epistemic-effect-v2";
import type { SelectKnowledgeForQuestionV2Input } from "@/lib/trader/knowledge/navigator";
import {
  buildClosedTradeOutcomeEvidencePackageV2,
  type ClosedTradeOutcomeEvidencePackageV2,
  type ClosedTradeOutcomeInputV2,
} from "@/lib/trader/research-v2/closed-trade-outcome-evidence-v2";
import { buildHumanPromotionProposalV2 } from "@/lib/trader/research-v2/human-promotion-proposal-v2";
import type { HumanPromotionProposalV2 } from "@/lib/trader/research-v2/human-promotion-proposal-v2";
import {
  queryBlindHoldoutAsIterativeFitnessV2,
  recordQualificationV2,
  recordRejectedCandidateV2,
  type QualificationEvaluationV2,
  type QualificationRecordV2,
  type QualificationVerdictV2,
  type RejectedCandidateRecordV2,
} from "@/lib/trader/research-v2/qualification-records-v2";
import {
  appendResearchMemoryV2,
  type ResearchMemoryV2,
} from "@/lib/trader/research-v2/research-memory-v2";
import {
  buildFalsifiableHypothesisV2,
  buildResearchQuestionV2,
  type FalsifiableHypothesisV2,
  type ResearchQuestionV2,
} from "@/lib/trader/research-v2/research-question-hypothesis-v2";
import {
  generateStrategyEvolutionCandidateV2,
  type StrategyCandidateGenerationKindV2,
  type StrategyEvolutionCandidateV2,
  type StrategyParentRefV2,
} from "@/lib/trader/research-v2/strategy-candidate-generation-v2";
import {
  admitStrategyEvolutionKnowledgeV2,
  type StrategyEvolutionKnowledgeAdmissionV2,
} from "@/lib/trader/research-v2/strategy-evolution-knowledge-admission-v2";

export const STRATEGY_EVOLUTION_LOOP_V2_SCHEMA = "waia.trader.strategy_evolution_loop.v2" as const;

export type StrategyEvolutionLoopStatusV2 = "HUMAN_PROPOSAL_PENDING" | "REJECTED" | "FAIL_CLOSED";

export type RunStrategyEvolutionResearchPassV2Input = Readonly<{
  organizationId: string;
  campaignId: string;
  symbol: string;
  evidenceCutoffUtc: string;
  researchCodeIdentity: string;
  costModelIdentity: string;
  outcomes: readonly ClosedTradeOutcomeInputV2[];
  navigatorSelect: SelectKnowledgeForQuestionV2Input | null;
  predictiveAdmissionVerdict: "ADMITTED" | "NOT_ADMITTED" | "RESEARCH_ONLY";
  futureCycleEffect: FutureCycleEpistemicEffectReceiptV2 | null;
  mkbInjectionAttempted?: boolean;
  legacyKnowledgeMutationAttempted?: boolean;
  holdoutQueryAttempted?: boolean;
  generation: {
    kind: StrategyCandidateGenerationKindV2;
    candidateId: string;
    strategyId: string;
    strategyVersion: string;
    parents: readonly StrategyParentRefV2[];
    params: Readonly<Record<string, string>>;
  };
  development: QualificationEvaluationV2;
  walkForward: QualificationEvaluationV2;
  qualificationVerdict: QualificationVerdictV2;
  failureReasons?: readonly string[];
}>;

export type StrategyEvolutionResearchPassV2 = Readonly<{
  schemaVersion: typeof STRATEGY_EVOLUTION_LOOP_V2_SCHEMA;
  capitalAuthority: "NONE" | "RESEARCH_ONLY";
  venueWriteAuthority: "NONE";
  status: StrategyEvolutionLoopStatusV2;
  evidencePackage: ClosedTradeOutcomeEvidencePackageV2;
  memory: ResearchMemoryV2;
  question: ResearchQuestionV2;
  hypothesis: FalsifiableHypothesisV2;
  candidate: StrategyEvolutionCandidateV2;
  development: QualificationRecordV2;
  walkForward: QualificationRecordV2;
  knowledge: StrategyEvolutionKnowledgeAdmissionV2;
  proposal: HumanPromotionProposalV2 | null;
  rejectedRecord: RejectedCandidateRecordV2 | null;
  contentDigestHex: string;
}>;

export function runStrategyEvolutionResearchPassV2(
  input: RunStrategyEvolutionResearchPassV2Input,
): StrategyEvolutionResearchPassV2 {
  if (input.holdoutQueryAttempted) {
    queryBlindHoldoutAsIterativeFitnessV2();
  }

  const evidencePackage = buildClosedTradeOutcomeEvidencePackageV2({
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    symbol: input.symbol,
    evidenceCutoffUtc: input.evidenceCutoffUtc,
    outcomes: input.outcomes,
  });
  const memory = appendResearchMemoryV2(evidencePackage);
  const question = buildResearchQuestionV2({
    questionId: `${input.campaignId}:question`,
    memory,
    symbol: input.symbol,
  });
  const hypothesis = buildFalsifiableHypothesisV2({
    hypothesisId: `${input.campaignId}:hypothesis`,
    question,
    generationKind: input.generation.kind,
  });
  const candidate = generateStrategyEvolutionCandidateV2({
    candidateId: input.generation.candidateId,
    strategyId: input.generation.strategyId,
    strategyVersion: input.generation.strategyVersion,
    kind: input.generation.kind,
    parents: input.generation.parents,
    params: input.generation.params,
    hypothesis,
    evidenceCutoffUtc: input.evidenceCutoffUtc,
    researchCodeIdentity: input.researchCodeIdentity,
    costModelIdentity: input.costModelIdentity,
  });
  const development = recordQualificationV2({
    candidate,
    partition: "DEVELOPMENT",
    evaluation: input.development,
    verdict: input.qualificationVerdict,
    failureReasons: input.failureReasons,
  });
  const walkForward = recordQualificationV2({
    candidate,
    partition: "WALK_FORWARD",
    evaluation: input.walkForward,
    verdict: input.qualificationVerdict,
    failureReasons: input.failureReasons,
  });
  const knowledge = admitStrategyEvolutionKnowledgeV2({
    navigatorSelect: input.navigatorSelect,
    predictiveAdmissionVerdict: input.predictiveAdmissionVerdict,
    futureCycleEffect: input.futureCycleEffect,
    mkbInjectionAttempted: input.mkbInjectionAttempted,
    legacyKnowledgeMutationAttempted: input.legacyKnowledgeMutationAttempted,
  });

  let status: StrategyEvolutionLoopStatusV2 = "HUMAN_PROPOSAL_PENDING";
  let proposal: HumanPromotionProposalV2 | null = null;
  let rejectedRecord: RejectedCandidateRecordV2 | null = null;
  let capitalAuthority: "NONE" | "RESEARCH_ONLY" = "RESEARCH_ONLY";

  if (knowledge.status === "FAIL_CLOSED") {
    status = "FAIL_CLOSED";
    capitalAuthority = "NONE";
  } else if (development.verdict === "REJECTED" || walkForward.verdict === "REJECTED") {
    status = "REJECTED";
    rejectedRecord = recordRejectedCandidateV2({ candidate, development, walkForward });
  } else {
    proposal = buildHumanPromotionProposalV2({
      proposalId: `${input.campaignId}:proposal`,
      candidate,
      hypothesis,
      memory,
      development,
      walkForward,
    });
  }

  const body = {
    schemaVersion: STRATEGY_EVOLUTION_LOOP_V2_SCHEMA,
    capitalAuthority,
    venueWriteAuthority: "NONE" as const,
    status,
    evidencePackage,
    memory,
    question,
    hypothesis,
    candidate,
    development,
    walkForward,
    knowledge,
    proposal,
    rejectedRecord,
  };
  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}
