export const RESEARCH_EVIDENCE_EXPORT_SCHEMA_VERSION =
  "waia.trader.research-evidence-export.v1" as const;

export type ResearchEvidenceExportSchemaVersion = typeof RESEARCH_EVIDENCE_EXPORT_SCHEMA_VERSION;

export const RESEARCH_REGIME_CLASSES = ["trend_up", "trend_down", "range", "high_vol"] as const;

export type ResearchRegimeClass = (typeof RESEARCH_REGIME_CLASSES)[number];

export type ResearchRegimeCoverage = {
  regimes: ResearchRegimeClass[];
  nonTrendingCount: number;
  downRegimeCount: number;
};

export type ResearchEvidenceExportBody = {
  backtestRunId: string;
  walkForwardRunId: string;
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
