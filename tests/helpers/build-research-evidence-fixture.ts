import {
  RESEARCH_EVIDENCE_EXPORT_SCHEMA_VERSION,
  type ResearchEvidenceDocument,
  type ResearchEvidenceExportBody,
} from "@/lib/trader/research/research-evidence-export.types";
import { computeResearchEvidenceExportDigest } from "@/lib/trader/research/serialize-research-evidence-export";

const DEFAULT_EXPORTED_AT = new Date("2026-06-18T12:00:00.000Z");

export function buildValidResearchEvidenceDocument(
  organizationId: string,
  overrides: {
    strategyId?: string;
    strategyVersion?: string;
    evidenceBody?: Partial<ResearchEvidenceExportBody>;
    exportedAt?: Date;
  } = {},
): ResearchEvidenceDocument {
  const evidenceBody: ResearchEvidenceExportBody = {
    datasetId: "00000000-0000-4000-8000-0000000ds1",
    backtestRunId: "00000000-0000-4000-8000-0000000b01",
    strategyCandidateId: "00000000-0000-4000-8000-0000000ca1",
    blindValidationResultId: "00000000-0000-4000-8000-0000000bl1",
    costModelVersion: "waia.trader.cost-model.v1",
    executionMode: "backtest",
    regimeCoverage: {
      regimes: ["RANGE", "TREND_BEAR"],
      nonTrendingCount: 1,
      downRegimeCount: 1,
      satisfiesRequirement: true,
    },
    ...overrides.evidenceBody,
  };

  const contentDigest = computeResearchEvidenceExportDigest(evidenceBody);
  const exportedAt = overrides.exportedAt ?? DEFAULT_EXPORTED_AT;

  return {
    schemaVersion: RESEARCH_EVIDENCE_EXPORT_SCHEMA_VERSION,
    envelope: {
      organizationId,
      strategyId: overrides.strategyId ?? "mean_reversion_v0",
      strategyVersion: overrides.strategyVersion ?? "0.1.0",
      exportedAt: exportedAt.toISOString(),
      contentDigest,
    },
    evidenceBody,
  };
}
