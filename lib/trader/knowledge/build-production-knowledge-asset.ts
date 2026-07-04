import { createHash } from "node:crypto";

import type { ResearchDatasetRecord } from "@/lib/trader/market-data/research-dataset-repository-postgres";
import type { BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";
import type { ResearchEvidenceDocument } from "@/lib/trader/research/research-evidence-export.types";
import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";
import { regimeSliceHasAttributedRoundTrips } from "@/lib/trader/research/regime-coverage";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

import {
  type ConfidenceMetadata,
  type DatasetLineage,
  type EvidenceRef,
  type EvolutionMetadata,
  type KnowledgeDomain,
  type MkbLinkage,
  type PkaCreationReason,
  type PkaLifecycleState,
  type ProductionKnowledgeAsset,
  PRODUCTION_KNOWLEDGE_ASSET_SCHEMA_VERSION,
  type ProvenanceChainEntry,
  type StrategyRef,
  type ValidationHistorySummary,
} from "@/lib/trader/knowledge/production-knowledge-asset.types";
import { readLegacyTradeCount } from "@/lib/trader/research/research-validation-metrics-taxonomy";
import { computeProductionKnowledgeAssetDigest } from "@/lib/trader/knowledge/serialize-production-knowledge-asset";

export type BuildProductionKnowledgeAssetInput = {
  evidenceDocument: ResearchEvidenceDocument;
  dataset: ResearchDatasetRecord;
  barSetDigest: string;
  barCount: number;
  symbol: InstrumentId;
  interval: BarInterval;
  walkForwardWindowCount: number;
  blindMetrics: ResearchValidationMetrics;
  mkbLinkage: MkbLinkage;
  edgeConfidence: string;
  edgeStrength: string;
  edgeVerified: boolean;
  builderGitSha?: string | null;
  creationReason?: PkaCreationReason;
  lifecycleState?: PkaLifecycleState;
  supersedesKnowledgeId?: string | null;
  paramsDigest?: string;
  /** Override only in tests; production uses evidence export time or dataset seal time. */
  sealedAt?: Date;
};

/** Deterministic PKA seal time — never uses runtime clock. */
export function resolveProductionKnowledgeAssetSealedAt(input: {
  evidenceDocument: ResearchEvidenceDocument;
  dataset: ResearchDatasetRecord;
  sealedAt?: Date;
}): string {
  if (input.sealedAt) {
    return input.sealedAt.toISOString();
  }
  const exportedAt = input.evidenceDocument.envelope.exportedAt?.trim();
  if (exportedAt) {
    return exportedAt;
  }
  return input.dataset.sealedAt.toISOString();
}

function computeKnowledgeId(payload: {
  knowledgeClass: string;
  knowledgeDomain: KnowledgeDomain;
  creationReason: PkaCreationReason;
  evidenceDigest: string;
  datasetDigest: string;
  strategyId: string;
  strategyVersion: string;
}): string {
  return createHash("sha256").update(computeStableJsonDigest(payload), "utf8").digest("hex");
}

function defaultInvalidationConditions(evidenceDigest: string): readonly string[] {
  return [
    "blind_holdout_rerun_attempted",
    "dataset_superseded_by_newer_seal",
    "regime_coverage_fails_on_revalidation",
    `evidence_digest_mismatch:${evidenceDigest}`,
  ];
}

export function buildProductionKnowledgeAsset(
  input: BuildProductionKnowledgeAssetInput,
): ProductionKnowledgeAsset {
  const body = input.evidenceDocument.evidenceBody;
  const envelope = input.evidenceDocument.envelope;
  const sealedAt = resolveProductionKnowledgeAssetSealedAt(input);
  const creationReason =
    input.creationReason ??
    (body.regimeCoverage.satisfiesRequirement
      ? "research_pipeline_blind_validated"
      : "research_pipeline_validation_failed");
  const lifecycleState: PkaLifecycleState =
    input.lifecycleState ??
    (creationReason === "research_pipeline_blind_validated" ? "maturation" : "creation");

  const knowledgeDomain: KnowledgeDomain = {
    instrument: input.symbol,
    interval: input.interval,
    venue: "htx",
  };

  const strategyRef: StrategyRef = {
    strategyId: envelope.strategyId,
    strategyVersion: envelope.strategyVersion,
    paramsDigest: input.paramsDigest ?? computeStableJsonDigest({}),
  };

  const evidenceRef: EvidenceRef = {
    contentDigest: envelope.contentDigest,
    datasetId: body.datasetId,
    backtestRunId: body.backtestRunId,
    strategyCandidateId: body.strategyCandidateId,
    blindValidationResultId: body.blindValidationResultId,
  };

  const datasetLineage: DatasetLineage = {
    source: "htx",
    symbol: input.symbol,
    interval: input.interval,
    barCount: input.barCount,
    barSetDigest: input.barSetDigest,
    trainDigest: input.dataset.trainDigest,
    validationDigest: input.dataset.validationDigest,
    blindDigest: input.dataset.blindDigest,
    builderGitSha: input.builderGitSha ?? null,
  };

  const provenanceChain: ProvenanceChainEntry[] = [
    { kind: "bars_source", id: "htx:market/history/kline" },
    { kind: "dataset", id: body.datasetId },
    { kind: "backtest_run", id: body.backtestRunId },
    { kind: "strategy_candidate", id: body.strategyCandidateId },
    {
      kind: "walk_forward_validation",
      id: `window_count:${input.walkForwardWindowCount}`,
    },
    { kind: "blind_validation_result", id: body.blindValidationResultId },
  ];

  const validationHistory: ValidationHistorySummary = {
    walkForwardWindowCount: input.walkForwardWindowCount,
    blindHoldoutTradeCount: readLegacyTradeCount(input.blindMetrics),
    blindHoldoutRegimeLabels: input.blindMetrics.byRegime
      .filter((slice) => regimeSliceHasAttributedRoundTrips(slice))
      .map((slice) => slice.regimeLabel),
  };

  const confidenceMetadata: ConfidenceMetadata = {
    edgeConfidence: input.edgeConfidence,
    edgeStrength: input.edgeStrength,
    edgeVerified: input.edgeVerified,
  };

  const evolutionMetadata: EvolutionMetadata = {
    lifecycleState,
    knowledgeNeed: null,
    evolutionProposal: null,
    supersedesKnowledgeId: input.supersedesKnowledgeId ?? null,
  };

  const knowledgeId = computeKnowledgeId({
    knowledgeClass: "regime_strategy_validation",
    knowledgeDomain,
    creationReason,
    evidenceDigest: envelope.contentDigest,
    datasetDigest: input.barSetDigest,
    strategyId: envelope.strategyId,
    strategyVersion: envelope.strategyVersion,
  });

  const assetWithoutDigest: Omit<ProductionKnowledgeAsset, "reproducibilityDigest"> = {
    schemaVersion: PRODUCTION_KNOWLEDGE_ASSET_SCHEMA_VERSION,
    knowledgeId,
    knowledgeClass: "regime_strategy_validation",
    knowledgeDomain,
    creationReason,
    supersedesKnowledgeId: input.supersedesKnowledgeId ?? null,
    strategyRef,
    sealedAt,
    evidenceRef,
    provenanceChain,
    datasetLineage,
    regimeCoverage: body.regimeCoverage,
    validationHistory,
    confidenceMetadata,
    invalidationConditions: defaultInvalidationConditions(envelope.contentDigest),
    evolutionMetadata,
    mkbLinkage: input.mkbLinkage,
  };

  const reproducibilityDigest = computeProductionKnowledgeAssetDigest(assetWithoutDigest);

  return {
    ...assetWithoutDigest,
    reproducibilityDigest,
  };
}
