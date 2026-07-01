import type { Regime } from "@/lib/trader/intelligence/types";

export const RESEARCH_EVIDENCE_EXPORT_SCHEMA_VERSION =
  "waia.trader.research-evidence-export.v2" as const;

export type ResearchEvidenceExportSchemaVersion = typeof RESEARCH_EVIDENCE_EXPORT_SCHEMA_VERSION;

/** CDE regime labels — see {@link ./regime-taxonomy.ts}. */
export type ResearchRegimeCoverage = {
  regimes: Regime[];
  nonTrendingCount: number;
  downRegimeCount: number;
  satisfiesRequirement: boolean;
};

export type ResearchEvidenceExportBody = {
  datasetId: string;
  backtestRunId: string;
  strategyCandidateId: string;
  blindValidationResultId: string;
  costModelVersion: string;
  executionMode: "backtest";
  regimeCoverage: ResearchRegimeCoverage;
};

export type ResearchEvidenceDocument = {
  schemaVersion: ResearchEvidenceExportSchemaVersion;
  envelope: {
    organizationId: string;
    strategyId: string;
    strategyVersion: string;
    exportedAt: string;
    contentDigest: string;
  };
  evidenceBody: ResearchEvidenceExportBody;
};

export type ResearchEvidenceSlot = {
  artifactSchemaVersion: ResearchEvidenceExportSchemaVersion;
  contentDigest: string;
  document: ResearchEvidenceDocument;
};

export type SerializedResearchRegimeCoverage = ResearchRegimeCoverage;

export type SerializedResearchEvidenceExportBody = ResearchEvidenceExportBody;
