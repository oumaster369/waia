import type { ResearchEvidenceDocument } from "@/lib/trader/research/research-evidence-export.types";
import { buildResearchRegimeCoverage } from "@/lib/trader/research/regime-taxonomy";
import { computeResearchEvidenceExportDigest } from "@/lib/trader/research/serialize-research-evidence-export";
import { RESEARCH_EVIDENCE_EXPORT_SCHEMA_VERSION } from "@/lib/trader/research/research-evidence-export.types";
import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";
import type { WalkForwardWindowResult } from "@/lib/trader/research/strategy-candidate.types";
import { regimeSliceHasAttributedRoundTrips } from "@/lib/trader/research/regime-coverage";

export type BuildResearchEvidenceDocumentInput = {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  datasetId: string;
  backtestRunId: string;
  strategyCandidateId: string;
  blindValidationResultId: string;
  costModelVersion: string;
  validationMetrics: ResearchValidationMetrics;
  walkForwardMetrics: readonly ResearchValidationMetrics[];
  blindMetrics: ResearchValidationMetrics;
  exportedAt?: Date;
};

/**
 * Assembles a digest-sealed research evidence document from persisted pipeline outputs.
 * Callers must pass IDs returned by the research orchestrator — never hand-authored UUIDs.
 */
export function buildResearchEvidenceDocument(
  input: BuildResearchEvidenceDocumentInput,
): ResearchEvidenceDocument {
  const regimeLabels = new Set<string>();
  for (const metrics of [
    input.validationMetrics,
    ...input.walkForwardMetrics,
    input.blindMetrics,
  ]) {
    for (const slice of metrics.byRegime) {
      if (regimeSliceHasAttributedRoundTrips(slice)) {
        regimeLabels.add(slice.regimeLabel);
      }
    }
  }

  const regimeCoverage = buildResearchRegimeCoverage([...regimeLabels]);
  const exportedAt = (input.exportedAt ?? new Date()).toISOString();

  const evidenceBody = {
    datasetId: input.datasetId,
    backtestRunId: input.backtestRunId,
    strategyCandidateId: input.strategyCandidateId,
    blindValidationResultId: input.blindValidationResultId,
    costModelVersion: input.costModelVersion,
    executionMode: "backtest" as const,
    regimeCoverage,
  };

  const contentDigest = computeResearchEvidenceExportDigest(evidenceBody);

  return {
    schemaVersion: RESEARCH_EVIDENCE_EXPORT_SCHEMA_VERSION,
    envelope: {
      organizationId: input.organizationId,
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
      exportedAt,
      contentDigest,
    },
    evidenceBody,
  };
}

export function collectMetricsFromWalkForwardWindows(
  windows: readonly WalkForwardWindowResult[],
): ResearchValidationMetrics[] {
  return windows.map((window) => window.metrics);
}
