import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  DEFAULT_DISCOVERY_RUN_CONFIG,
  type DiscoveryRunConfig,
  type DiscoveryRunContext,
} from "@/lib/trader/discovery/discovery.types";
import { synthesizeObservations } from "@/lib/trader/discovery/observation-synthesizer";
import { clusterStructureSignatures } from "@/lib/trader/discovery/structure-clusterer";
import { buildResearchQuestion } from "@/lib/trader/discovery/research-question-builder";
import { runHypothesisStudio } from "@/lib/trader/discovery/hypothesis-studio";
import { synthesizeDefaultStrategy } from "@/lib/trader/generator/strategy-synthesizer";
import { buildCandidateProposal } from "@/lib/trader/discovery/candidate-factory";
import { rankCandidatesByEpistemicEvidence } from "@/lib/trader/discovery/candidate-comparator";
import { buildPromotionProposal } from "@/lib/trader/discovery/promotion-proposal-builder";
import type { Bar } from "@/lib/trader/intelligence/types";
import type { PaperClosedTrade } from "@/lib/trader/paper/paper-strategy-eval.types";
import type { ResearchRejectionRecord } from "@/lib/trader/research/research-rejection-record.types";
import { assertNoBannedFields } from "@/lib/trader/discovery/no-reinforcement-guard";

export type DiscoveryEvolutionPassInput = {
  runContext: DiscoveryRunContext;
  config?: DiscoveryRunConfig;
  bars: readonly Bar[];
  closedTrades: readonly PaperClosedTrade[];
  rejectionContext?: ResearchRejectionRecord | null;
  strategyId?: string;
  strategyVersion?: string;
  newId?: () => string;
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
};

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update" | "delete">;

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

  const newId = input.newId ?? crypto.randomUUID.bind(crypto);
  const strategyId =
    input.strategyId ?? input.rejectionContext?.recordBody.strategyId ?? "mean_reversion_v0";
  const strategyVersion =
    input.strategyVersion ?? input.rejectionContext?.recordBody.strategyVersion ?? "0.1.0";

  const observation = synthesizeObservations(
    {
      campaignRef: input.runContext.campaignRef,
      context: input.runContext.context,
      barWindow: {
        symbol: input.bars[0]?.symbol ?? "BTC/USDT",
        start: input.bars[0]?.barOpenTime ?? new Date().toISOString(),
        end: input.bars.at(-1)?.barCloseTime ?? new Date().toISOString(),
      },
      bars: input.bars,
      closedTrades: input.closedTrades,
    },
    newId(),
  );

  const clusters = clusterStructureSignatures(
    {
      campaignRef: input.runContext.campaignRef,
      observations: [observation],
    },
    newId,
  );
  const cluster = clusters[0];
  if (!cluster) {
    return {
      skipped: true,
      reason: "no_structure_clusters",
    };
  }

  const researchQuestion = buildResearchQuestion({
    campaignRef: input.runContext.campaignRef,
    cluster,
    rejectionContext: input.rejectionContext,
    strategyId,
    questionId: newId(),
  });

  const hypothesisStudio = runHypothesisStudio({
    organizationId: input.runContext.context.organizationId,
    campaignId: input.runContext.campaignRef.campaignId,
    researchQuestion,
    rejectionContext: input.rejectionContext,
    strategyId,
    strategyVersion,
    proposalId: newId(),
  });

  const synthesis = synthesizeDefaultStrategy("mean_reversion_v0", newId(), strategyVersion);
  const candidateProposal = buildCandidateProposal({
    hypothesisProposal: hypothesisStudio.proposal,
    synthesis,
    candidateId: newId(),
  });

  const comparison = rankCandidatesByEpistemicEvidence({
    candidates: [candidateProposal.candidateId],
    evidenceByCandidate: new Map(),
  });

  const promotionProposal = buildPromotionProposal({
    organizationId: input.runContext.context.organizationId,
    campaignId: input.runContext.campaignRef.campaignId,
    candidateId: candidateProposal.candidateId,
    comparison,
    proposalId: newId(),
  });

  return {
    skipped: false,
    observationId: observation.observationId,
    researchQuestionId: researchQuestion.questionId,
    hypothesisProposalId: hypothesisStudio.proposal.proposalId,
    synthesisId: synthesis.synthesisId,
    candidateProposalId: candidateProposal.candidateId,
    comparisonDigest: comparison.comparisonDigest,
    promotionProposalId: promotionProposal.proposalId,
  };
}
