import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { Regime } from "@/lib/trader/intelligence/types";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import {
  buildResearchRegimeCoverage,
  hasSufficientCanonicalRegimeCoverage,
  isCanonicalResearchRegimeLabel,
} from "@/lib/trader/research/regime-taxonomy";
import type { ResearchRegimeCoverage } from "@/lib/trader/research/research-evidence-export.types";
import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";
import { collectRegimeLabelsFromMetrics } from "@/lib/trader/research/regime-coverage";
import { buildResearchEvidenceDocument } from "@/lib/trader/research/build-research-evidence-export";
import type { ResearchEvidenceDocument } from "@/lib/trader/research/research-evidence-export.types";
import type { RunResearchPipelineResult } from "@/lib/trader/research/research-orchestrator";
import { computeResearchEvidenceExportDigest } from "@/lib/trader/research/serialize-research-evidence-export";

export const HTR_WP22_MULTI_REGIME_POSTGRES_EVIDENCE_SCHEMA =
  "htr-wp22-multi-regime-postgres-evidence/v1" as const;

export type HtrWp22MultiRegimePostgresEvidenceResult = {
  schemaVersion: typeof HTR_WP22_MULTI_REGIME_POSTGRES_EVIDENCE_SCHEMA;
  terminalState: "HTR_WP22_MULTI_REGIME_POSTGRES_PASS" | "HTR_WP22_MULTI_REGIME_POSTGRES_FAIL";
  gapId: "HTR-GAP-044";
  regimeCoverage: ResearchRegimeCoverage;
  observedRegimeLabels: string[];
  tradeAttributedRegimeLabels: string[];
  metricsObservedRegimeLabels: string[];
  cycleClassifiedRegimeLabels: string[];
  metricsSources: {
    validation: boolean;
    walkForward: boolean;
    blind: boolean;
    validationCycles: boolean;
    metricsObservedRegimes: boolean;
  };
  payloadSha256?: string;
};

/**
 * Regime labels present in persisted validation metrics `byRegime` slices regardless of
 * trade attribution — production CDE/walk-forward lineage for GAP-044 (not trade gating).
 */
export function collectMetricsObservedRegimeLabels(
  metrics: readonly ResearchValidationMetrics[],
): Regime[] {
  const labels = new Set<Regime>();
  for (const entry of metrics) {
    for (const slice of entry.byRegime) {
      if (isCanonicalResearchRegimeLabel(slice.regimeLabel)) {
        labels.add(slice.regimeLabel);
      }
    }
  }
  return [...labels].sort((a, b) => a.localeCompare(b));
}

/** Production CDE regime labels observed across validation replay cycles (no seeding). */
export function collectRegimeLabelsFromCycleResults(cycles: readonly PaperCycleResult[]): Regime[] {
  const labels = new Set<Regime>();
  for (const cycle of cycles) {
    const regime = cycle.evaluation.msv.derived.regime;
    if (isCanonicalResearchRegimeLabel(regime)) {
      labels.add(regime);
    }
  }
  return [...labels].sort((a, b) => a.localeCompare(b));
}

export function buildHtrWp22MultiRegimePostgresEvidence(input: {
  validationMetrics: ResearchValidationMetrics;
  walkForwardMetrics: readonly ResearchValidationMetrics[];
  blindMetrics: ResearchValidationMetrics;
  validationCycleResults?: readonly PaperCycleResult[];
}): HtrWp22MultiRegimePostgresEvidenceResult {
  const allMetrics = [
    input.validationMetrics,
    ...input.walkForwardMetrics,
    input.blindMetrics,
  ] as const;
  const tradeAttributedRegimeLabels = collectRegimeLabelsFromMetrics([...allMetrics]);
  const metricsObservedRegimeLabels = collectMetricsObservedRegimeLabels([...allMetrics]);
  const cycleClassifiedRegimeLabels = input.validationCycleResults
    ? collectRegimeLabelsFromCycleResults(input.validationCycleResults)
    : [];
  const observedRegimeLabels = [
    ...new Set([
      ...tradeAttributedRegimeLabels,
      ...metricsObservedRegimeLabels,
      ...cycleClassifiedRegimeLabels,
    ]),
  ].sort((a, b) => a.localeCompare(b));
  const regimeCoverage = buildResearchRegimeCoverage(observedRegimeLabels);
  const passed = hasSufficientCanonicalRegimeCoverage(regimeCoverage);

  const semanticBody = {
    schemaVersion: HTR_WP22_MULTI_REGIME_POSTGRES_EVIDENCE_SCHEMA,
    terminalState: passed
      ? ("HTR_WP22_MULTI_REGIME_POSTGRES_PASS" as const)
      : ("HTR_WP22_MULTI_REGIME_POSTGRES_FAIL" as const),
    gapId: "HTR-GAP-044" as const,
    regimeCoverage,
    observedRegimeLabels,
    tradeAttributedRegimeLabels,
    metricsObservedRegimeLabels,
    cycleClassifiedRegimeLabels,
    metricsSources: {
      validation: input.validationMetrics.byRegime.length > 0,
      walkForward: input.walkForwardMetrics.some((entry) => entry.byRegime.length > 0),
      blind: input.blindMetrics.byRegime.length > 0,
      validationCycles: cycleClassifiedRegimeLabels.length > 0,
      metricsObservedRegimes: metricsObservedRegimeLabels.length > 0,
    },
  };

  return {
    ...semanticBody,
    payloadSha256: computeSemanticSha256Hex(semanticBody),
  };
}

export function evaluateHtrWp22MultiRegimePostgresEvidence(
  result: HtrWp22MultiRegimePostgresEvidenceResult,
): boolean {
  return (
    result.terminalState === "HTR_WP22_MULTI_REGIME_POSTGRES_PASS" &&
    hasSufficientCanonicalRegimeCoverage(result.regimeCoverage) &&
    result.metricsSources.metricsObservedRegimes
  );
}

/**
 * Rebuilds a digest-sealed research evidence document using persisted pipeline artifact IDs
 * and GAP-044 metrics-observed regime lineage (includes valid NO_TRADE slices).
 */
export function buildHtrGap044ResearchEvidenceDocumentFromPipeline(input: {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  costModelVersion: string;
  pipeline: Pick<
    RunResearchPipelineResult,
    | "dataset"
    | "backtestRunId"
    | "strategyCandidateId"
    | "blindValidationResultId"
    | "validationMetrics"
    | "blindMetrics"
  >;
  walkForwardMetrics: readonly ResearchValidationMetrics[];
}): ResearchEvidenceDocument {
  const metricsObservedLabels = collectMetricsObservedRegimeLabels([
    input.pipeline.validationMetrics,
    ...input.walkForwardMetrics,
    input.pipeline.blindMetrics,
  ]);
  const baseDocument = buildResearchEvidenceDocument({
    organizationId: input.organizationId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    datasetId: input.pipeline.dataset.id,
    backtestRunId: input.pipeline.backtestRunId,
    strategyCandidateId: input.pipeline.strategyCandidateId,
    blindValidationResultId: input.pipeline.blindValidationResultId,
    costModelVersion: input.costModelVersion,
    validationMetrics: input.pipeline.validationMetrics,
    walkForwardMetrics: input.walkForwardMetrics,
    blindMetrics: input.pipeline.blindMetrics,
  });

  const regimeCoverage = buildResearchRegimeCoverage(metricsObservedLabels);
  const evidenceBody = {
    ...baseDocument.evidenceBody,
    regimeCoverage,
  };

  return {
    ...baseDocument,
    evidenceBody,
    envelope: {
      ...baseDocument.envelope,
      contentDigest: computeResearchEvidenceExportDigest(evidenceBody),
    },
  };
}
