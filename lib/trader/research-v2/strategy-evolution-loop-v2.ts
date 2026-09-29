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
import { buildResearchRetirementProposalV2 } from "@/lib/trader/research-v2/research-retirement-proposal-v2";
import type { ResearchRetirementProposalV2 } from "@/lib/trader/research-v2/research-retirement-proposal-v2";
import {
  RESEARCH_HYPOTHESIS_FAMILY_V2_SCHEMA,
  type ResearchHypothesisFamilyV2,
} from "@/lib/trader/research-v2/multiple-testing-holm-v2";
import {
  AppendOnlyStrategyAdmissionJournal,
  strategyAdmissionHypothesisId,
  type StrategyAdmissionJournalRow,
  type StrategyAdmissionObservation,
} from "@/lib/trader/research/strategy-admission-v1";
import {
  queryBlindHoldoutAsIterativeFitnessV2,
  recordQualificationV2,
  recordRejectedCandidateV2,
  assertQualificationPartitionsIndependentV2,
  type QualificationEvaluationV2,
  type QualificationRecordV2,
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
import { deriveStrategyEvolutionGenerationV2 } from "@/lib/trader/research-v2/strategy-candidate-generation-derive-v2";
import {
  generateStrategyEvolutionCandidateV2,
  type StrategyCandidateGenerationKindV2,
  type StrategyEvolutionCandidateV2,
  type StrategyParentRefV2,
} from "@/lib/trader/research-v2/strategy-candidate-generation-v2";
import { StrategyEvolutionResearchError } from "@/lib/trader/research-v2/research-v2-guards";
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
  generation?: {
    kind: StrategyCandidateGenerationKindV2;
    candidateId: string;
    strategyId: string;
    strategyVersion: string;
    parents: readonly StrategyParentRefV2[];
    params: Readonly<Record<string, string>>;
  };
  parentStrategies?: readonly StrategyParentRefV2[];
  priorMemory?: ResearchMemoryV2;
  development: QualificationEvaluationV2;
  walkForward: QualificationEvaluationV2;
  /** sha256 of the hypothesis spec, recorded before this run reads its target data. */
  specSha256: string;
  /** Pre-declared family size. More configurations than this are refused. */
  declaredFamilySize: number;
  /** Other IS configurations in the pre-declared family. Holm uses the declared size. */
  additionalIsObservations?: readonly (readonly StrategyAdmissionObservation[])[];
  /** Durable append-only journal. An in-memory journal is refused. */
  journal: AppendOnlyStrategyAdmissionJournal;
  /** Required. Discovery data must be declared true and is rejected as IS evidence. */
  usedForDiscovery: boolean;
  signalBarCloseUtc?: string;
  entryTimeUtc?: string;
  barIntervalMinutes?: number;
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
  multipleTesting: ResearchHypothesisFamilyV2;
  journalRows: readonly StrategyAdmissionJournalRow[];
  knowledge: StrategyEvolutionKnowledgeAdmissionV2;
  proposal: HumanPromotionProposalV2 | null;
  rejectedRecord: RejectedCandidateRecordV2 | null;
  retirementProposal: ResearchRetirementProposalV2 | null;
  contentDigestHex: string;
}>;

export function runStrategyEvolutionResearchPassV2(
  input: RunStrategyEvolutionResearchPassV2Input & { qualificationVerdict?: never },
): StrategyEvolutionResearchPassV2 {
  if (Object.prototype.hasOwnProperty.call(input, "qualificationVerdict")) {
    throw new StrategyEvolutionResearchError(
      "QUALIFICATION_VERDICT_NOT_ACCEPTED_FROM_CALLER",
      "research-v2 verdict is computed from partition evidence",
    );
  }
  if (input.holdoutQueryAttempted) {
    queryBlindHoldoutAsIterativeFitnessV2();
  }
  assertQualificationPartitionsIndependentV2(input.development, input.walkForward);

  const generation =
    input.generation ??
    (input.parentStrategies && input.parentStrategies.length > 0
      ? deriveStrategyEvolutionGenerationV2({
          candidateId: `${input.campaignId}:candidate`,
          parents: input.parentStrategies,
          researchCodeIdentity: input.researchCodeIdentity,
        })
      : null);
  if (!generation) {
    throw new StrategyEvolutionResearchError("GENERATION_INCOMPLETE");
  }

  const evidencePackage = buildClosedTradeOutcomeEvidencePackageV2({
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    symbol: input.symbol,
    evidenceCutoffUtc: input.evidenceCutoffUtc,
    outcomes: input.outcomes,
  });
  const memory = appendResearchMemoryV2(evidencePackage, input.priorMemory);
  const question = buildResearchQuestionV2({
    questionId: `${input.campaignId}:question`,
    memory,
    symbol: input.symbol,
  });
  const hypothesis = buildFalsifiableHypothesisV2({
    hypothesisId: `${input.campaignId}:hypothesis`,
    question,
    generationKind: generation.kind,
  });
  const candidate = generateStrategyEvolutionCandidateV2({
    candidateId: generation.candidateId,
    strategyId: generation.strategyId,
    strategyVersion: generation.strategyVersion,
    kind: generation.kind,
    parents: generation.parents,
    params: generation.params,
    hypothesis,
    evidenceCutoffUtc: input.evidenceCutoffUtc,
    researchCodeIdentity: input.researchCodeIdentity,
    costModelIdentity: input.costModelIdentity,
  });
  if (!input.journal?.durable) {
    throw new StrategyEvolutionResearchError(
      "admission_journal_unavailable",
      "the research pass requires a durable admission journal",
    );
  }
  if (typeof input.usedForDiscovery !== "boolean") {
    throw new StrategyEvolutionResearchError("used_for_discovery_required");
  }
  const journal = input.journal;
  const hypothesisId = strategyAdmissionHypothesisId(input.specSha256, generation.params);
  journal.registerFamily(input.specSha256, input.declaredFamilySize);
  const signalBarCloseUtc = input.signalBarCloseUtc ?? input.evidenceCutoffUtc;
  const signalMs = Date.parse(signalBarCloseUtc);
  const entryTimeUtc =
    input.entryTimeUtc ??
    (Number.isFinite(signalMs) ? new Date(signalMs + 60_000).toISOString() : "");
  const admissionContext = {
    hypothesisId,
    usedForDiscovery: input.usedForDiscovery,
    signalBarCloseUtc,
    entryTimeUtc,
    barIntervalMinutes: input.barIntervalMinutes,
    symbol: input.symbol,
    journal,
  };
  const isFamily = [input.development.dateNets ?? [], ...(input.additionalIsObservations ?? [])];
  const development = recordQualificationV2({
    candidate,
    partition: "DEVELOPMENT",
    evaluation: input.development,
    failureReasons: input.failureReasons,
    specSha256: input.specSha256,
    declaredFamilySize: input.declaredFamilySize,
    familyObservations: isFamily,
    trialIndex: 0,
    ...admissionContext,
  });
  const isPassed =
    development.verdict === "QUALIFIED" && development.admission.assessment.verdict === "passed_is";
  journal.append({
    correctsRowIndex: null,
    hypothesisId,
    specSha256: input.specSha256,
    split: "is",
    familySize: input.declaredFamilySize,
    configParamsJson: JSON.stringify(generation.params),
    nEvents: development.admission.assessment.nEvents,
    nDates: development.admission.assessment.nDates,
    netMeanDate: development.admission.assessment.netMeanDate,
    seMethod: "newey_west",
    nwLag: development.admission.assessment.nwLag,
    t: development.admission.assessment.t,
    pRaw: development.admission.assessment.pRaw,
    pHolm: development.admission.assessment.pHolm,
    verdict: development.admission.assessment.verdict,
    verdictReason: development.failureReasons.join(",") || "passed",
    flags: development.admission.assessment.flags,
    countsAsSplitUse: false,
  });
  const walkForward = isPassed
    ? recordQualificationV2({
        candidate,
        partition: "WALK_FORWARD",
        evaluation: input.walkForward,
        failureReasons: input.failureReasons,
        specSha256: input.specSha256,
        declaredFamilySize: input.declaredFamilySize,
        familyObservations: [input.walkForward.dateNets ?? []],
        trialIndex: 0,
        ...admissionContext,
      })
    : recordQualificationV2({
        candidate,
        partition: "WALK_FORWARD",
        evaluation: input.walkForward,
        failureReasons: input.failureReasons,
        specSha256: input.specSha256,
        declaredFamilySize: input.declaredFamilySize,
        familyObservations: [input.walkForward.dateNets ?? []],
        trialIndex: 0,
        unscored: true,
        ...admissionContext,
      });
  const multipleTesting: ResearchHypothesisFamilyV2 = {
    schemaVersion: RESEARCH_HYPOTHESIS_FAMILY_V2_SCHEMA,
    method: "holm",
    familySize: development.admission.assessment.familySize,
    alpha: "0.05",
    trials: development.admission.assessment.familyTrials.map((trial) => ({
      trialIndex: trial.trialIndex,
      rawPValue: trial.rawPValue,
      adjustedPValue: trial.adjustedPValue,
      holmRank: trial.holmRank,
    })),
  };
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
  let retirementProposal: ResearchRetirementProposalV2 | null = null;
  let capitalAuthority: "NONE" | "RESEARCH_ONLY" = "RESEARCH_ONLY";

  if (knowledge.status === "FAIL_CLOSED") {
    status = "FAIL_CLOSED";
    capitalAuthority = "NONE";
  } else if (development.verdict === "REJECTED" || walkForward.verdict === "REJECTED") {
    status = "REJECTED";
    rejectedRecord = recordRejectedCandidateV2({ candidate, development, walkForward });
    retirementProposal = buildResearchRetirementProposalV2({
      proposalId: `${input.campaignId}:retirement`,
      candidate,
      memory,
      rejectedRecord,
    });
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
    multipleTesting,
    journalRows: journal.list(),
    knowledge,
    proposal,
    rejectedRecord,
    retirementProposal,
  };
  return Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  });
}
