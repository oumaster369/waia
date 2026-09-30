import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  DEFAULT_DISCOVERY_RUN_CONFIG,
  type DiscoveryRunConfig,
  type DiscoveryRunContext,
} from "@/lib/trader/discovery/discovery.types";
import { assertNoBannedFields } from "@/lib/trader/discovery/no-reinforcement-guard";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { Bar } from "@/lib/trader/intelligence/types";
import type { SelectKnowledgeForQuestionV2Input } from "@/lib/trader/knowledge/navigator";
import type { FutureCycleEpistemicEffectReceiptV2 } from "@/lib/trader/knowledge/navigator/future-cycle-epistemic-effect-v2";
import type { PaperClosedTrade } from "@/lib/trader/paper/paper-strategy-eval.types";
import type { ResearchRejectionRecord } from "@/lib/trader/research/research-rejection-record.types";
import {
  AppendOnlyStrategyAdmissionJournal,
  defaultStrategyAdmissionJournalPath,
} from "@/lib/trader/research/strategy-admission-v1";
import {
  assertPartitionEvaluationMatchesWindowsV2,
  deriveQualificationEvaluationFromPartitionWindowsV2,
  deriveStrategyEvolutionGenerationV2,
  enqueueResearchJobV2,
  runStrategyEvolutionResearchPassV2,
  StrategyEvolutionResearchError,
  type ClosedTradeOutcomeInputV2,
  type ClosedTradeOutcomePolarityV2,
  type PartitionWindowMetricV2,
  type QualificationEvaluationV2,
  type ResearchMemoryV2,
  type StrategyCandidateGenerationKindV2,
  type StrategyEvolutionLoopStatusV2,
  type StrategyParentRefV2,
} from "@/lib/trader/research-v2";

export type DiscoveryResearchV2GenerationInput = {
  kind: StrategyCandidateGenerationKindV2;
  candidateId: string;
  strategyId: string;
  strategyVersion: string;
  parents: readonly StrategyParentRefV2[];
  params: Readonly<Record<string, string>>;
};

export type DiscoveryEvolutionPassInput = {
  runContext: DiscoveryRunContext;
  config?: DiscoveryRunConfig;
  bars: readonly Bar[];
  closedTrades: readonly PaperClosedTrade[];
  rejectionContext?: ResearchRejectionRecord | null;
  strategyId?: string;
  strategyVersion?: string;
  newId?: () => string;
  navigatorSelect?: SelectKnowledgeForQuestionV2Input | null;
  predictiveAdmissionVerdict?: "ADMITTED" | "NOT_ADMITTED" | "RESEARCH_ONLY";
  futureCycleEffect?: FutureCycleEpistemicEffectReceiptV2 | null;
  researchCodeIdentity?: string;
  costModelIdentity?: string;
  generation?: DiscoveryResearchV2GenerationInput;
  development?: QualificationEvaluationV2;
  walkForward?: QualificationEvaluationV2;
  developmentWindows?: readonly PartitionWindowMetricV2[];
  walkForwardWindows?: readonly PartitionWindowMetricV2[];
  holdoutQueryAttempted?: boolean;
  mkbInjectionAttempted?: boolean;
  legacyKnowledgeMutationAttempted?: boolean;
  failureReasons?: readonly string[];
  specSha256?: string;
  declaredFamilySize?: number;
  /** Durable admission journal. Opened at the default path when omitted. */
  journal?: AppendOnlyStrategyAdmissionJournal;
  journalPath?: string;
  usedForDiscovery?: boolean;
  evidenceCutoffUtc?: string;
  symbol?: string;
  parentStrategies?: readonly StrategyParentRefV2[];
  priorMemory?: ResearchMemoryV2;
  capitalRuntimeActive?: boolean;
};

export type DiscoveryEvolutionPassResult = {
  skipped: boolean;
  reason?: string;
  observationId?: string;
  researchQuestionId?: string;
  hypothesisProposalId?: string;
  synthesisId?: string;
  candidateProposalId?: string;
  comparisonDigest?: string;
  promotionProposalId?: string;
  status?: StrategyEvolutionLoopStatusV2;
  capitalAuthority?: "NONE" | "RESEARCH_ONLY";
  outcomePolarities?: readonly ClosedTradeOutcomePolarityV2[];
};

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update" | "delete">;

type EnabledResearchV2Admission = {
  navigatorSelect: SelectKnowledgeForQuestionV2Input | null;
  predictiveAdmissionVerdict: "ADMITTED" | "NOT_ADMITTED" | "RESEARCH_ONLY";
  futureCycleEffect: FutureCycleEpistemicEffectReceiptV2 | null;
  researchCodeIdentity: string;
  costModelIdentity: string;
  development: QualificationEvaluationV2;
  walkForward: QualificationEvaluationV2;
};

function failClosed(reason: string): DiscoveryEvolutionPassResult {
  return {
    skipped: true,
    reason,
    status: "FAIL_CLOSED",
    capitalAuthority: "NONE",
  };
}

function resolveEnabledResearchV2Admission(
  input: DiscoveryEvolutionPassInput & { qualificationVerdict?: unknown },
): EnabledResearchV2Admission | null {
  if (Object.prototype.hasOwnProperty.call(input, "qualificationVerdict")) {
    throw new StrategyEvolutionResearchError(
      "QUALIFICATION_VERDICT_NOT_ACCEPTED_FROM_CALLER",
      "research-v2 verdict is computed from partition evidence",
    );
  }
  if (
    input.navigatorSelect === undefined ||
    input.futureCycleEffect === undefined ||
    input.predictiveAdmissionVerdict === undefined ||
    input.researchCodeIdentity === undefined ||
    input.costModelIdentity === undefined ||
    input.developmentWindows === undefined ||
    input.walkForwardWindows === undefined
  ) {
    return null;
  }
  const development = deriveQualificationEvaluationFromPartitionWindowsV2(input.developmentWindows);
  const walkForward = deriveQualificationEvaluationFromPartitionWindowsV2(input.walkForwardWindows);
  assertPartitionEvaluationMatchesWindowsV2(input.development, development);
  assertPartitionEvaluationMatchesWindowsV2(input.walkForward, walkForward);
  return {
    navigatorSelect: input.navigatorSelect,
    predictiveAdmissionVerdict: input.predictiveAdmissionVerdict,
    futureCycleEffect: input.futureCycleEffect,
    researchCodeIdentity: input.researchCodeIdentity,
    costModelIdentity: input.costModelIdentity,
    development,
    walkForward,
  };
}

export function mapClosedTradesToOutcomeInputsV2(
  closedTrades: readonly PaperClosedTrade[],
): ClosedTradeOutcomeInputV2[] {
  return closedTrades.map((trade) => {
    const observedAtUtc = trade.executedAt.toISOString();
    return {
      outcomeId: trade.fillId,
      closedTradeRef: trade.orderId,
      observedAtUtc,
      netEconomicResult: trade.tradePnl,
      causalContextDigestHex: computeSemanticSha256Hex({
        fillId: trade.fillId,
        orderId: trade.orderId,
        symbol: trade.symbol,
        executedAt: observedAtUtc,
      }),
    };
  });
}

export async function runDiscoveryEvolutionPass(
  _ex: PgExecutor,
  input: DiscoveryEvolutionPassInput,
): Promise<DiscoveryEvolutionPassResult> {
  const config = input.config ?? input.runContext.config ?? DEFAULT_DISCOVERY_RUN_CONFIG;
  assertNoBannedFields(config, "discoveryRunConfig");

  if (!config.enabled) {
    return {
      skipped: true,
      reason: "discovery_run_disabled",
    };
  }

  if (input.runContext.campaignRef.state !== "ACTIVE") {
    return {
      skipped: true,
      reason: "campaign_not_active",
    };
  }

  if (input.capitalRuntimeActive === true) {
    enqueueResearchJobV2({
      jobId: input.newId?.() ?? `${input.runContext.campaignRef.campaignId}:research-job`,
      organizationId: input.runContext.context.organizationId,
      campaignId: input.runContext.campaignRef.campaignId,
      budgetMs: 1,
      capitalRuntimeActive: true,
    });
    return {
      skipped: true,
      reason: "research_yielded_to_capital_runtime",
      capitalAuthority: "NONE",
    };
  }

  const admission = resolveEnabledResearchV2Admission(input);
  if (!admission) {
    return failClosed("research_v2_admission_incomplete");
  }

  const generation =
    input.generation ??
    (input.parentStrategies && input.parentStrategies.length > 0
      ? deriveStrategyEvolutionGenerationV2({
          candidateId: input.newId?.() ?? `${input.runContext.campaignRef.campaignId}:candidate`,
          parents: input.parentStrategies,
          researchCodeIdentity: admission.researchCodeIdentity,
        })
      : null);
  if (!generation) {
    return failClosed("research_v2_generation_incomplete");
  }

  const outcomes = mapClosedTradesToOutcomeInputsV2(input.closedTrades);
  const symbol = input.symbol ?? input.closedTrades[0]?.symbol ?? input.bars[0]?.symbol ?? "";
  const evidenceCutoffUtc =
    input.evidenceCutoffUtc ??
    input.closedTrades.at(-1)?.executedAt.toISOString() ??
    input.bars.at(-1)?.barCloseTime ??
    "";
  if (outcomes.length === 0 || symbol.trim() === "" || evidenceCutoffUtc.trim() === "") {
    return failClosed("research_v2_outcomes_required");
  }
  if (typeof input.usedForDiscovery !== "boolean") {
    return failClosed("used_for_discovery_required");
  }
  let journal = input.journal;
  if (!journal?.durable) {
    try {
      journal = AppendOnlyStrategyAdmissionJournal.openDurable(
        input.journalPath ?? defaultStrategyAdmissionJournalPath(),
      );
    } catch {
      return failClosed("admission_journal_unavailable");
    }
  }

  const pass = runStrategyEvolutionResearchPassV2({
    organizationId: input.runContext.context.organizationId,
    campaignId: input.runContext.campaignRef.campaignId,
    symbol,
    evidenceCutoffUtc,
    researchCodeIdentity: admission.researchCodeIdentity,
    costModelIdentity: admission.costModelIdentity,
    outcomes,
    navigatorSelect: admission.navigatorSelect,
    predictiveAdmissionVerdict: admission.predictiveAdmissionVerdict,
    futureCycleEffect: admission.futureCycleEffect,
    mkbInjectionAttempted: input.mkbInjectionAttempted,
    legacyKnowledgeMutationAttempted: input.legacyKnowledgeMutationAttempted,
    holdoutQueryAttempted: input.holdoutQueryAttempted,
    generation,
    development: admission.development,
    walkForward: admission.walkForward,
    failureReasons: input.failureReasons,
    specSha256: input.specSha256 ?? "",
    declaredFamilySize: input.declaredFamilySize ?? 0,
    priorMemory: input.priorMemory,
    journal,
    usedForDiscovery: input.usedForDiscovery,
  });

  return {
    skipped: false,
    observationId: pass.evidencePackage.contentDigestHex,
    researchQuestionId: pass.question.questionId,
    hypothesisProposalId: pass.hypothesis.hypothesisId,
    synthesisId: pass.candidate.contentDigestHex,
    candidateProposalId: pass.candidate.candidateId,
    comparisonDigest: pass.contentDigestHex,
    promotionProposalId: pass.proposal?.proposalId,
    status: pass.status,
    capitalAuthority: pass.capitalAuthority,
    outcomePolarities: pass.evidencePackage.polaritiesPresent,
  };
}
