export const EPISTEMIC_EVIDENCE_SCHEMA_VERSION = "waia.trader.discovery-evidence.v1" as const;

/** Closed allowlist — comparator ranks on these dimensions only (no PnL). */
export enum EpistemicEvidenceDimension {
  RegimeCoverage = "regime_coverage",
  Reproducibility = "reproducibility",
  FalsificationRisk = "falsification_risk",
  SampleAdequacy = "sample_adequacy",
  StructuralCoherence = "structural_coherence",
  ContradictionPresent = "contradiction_present",
  BlindDiscipline = "blind_discipline",
  ProvenanceComplete = "provenance_complete",
}

export const EPISTEMIC_EVIDENCE_DIMENSIONS = [
  EpistemicEvidenceDimension.RegimeCoverage,
  EpistemicEvidenceDimension.Reproducibility,
  EpistemicEvidenceDimension.FalsificationRisk,
  EpistemicEvidenceDimension.SampleAdequacy,
  EpistemicEvidenceDimension.StructuralCoherence,
  EpistemicEvidenceDimension.ContradictionPresent,
  EpistemicEvidenceDimension.BlindDiscipline,
  EpistemicEvidenceDimension.ProvenanceComplete,
] as const;

export type EpistemicEvidenceDirection = "FOR" | "AGAINST" | "NEUTRAL";

export type EpistemicEvidenceRecord = {
  schemaVersion: typeof EPISTEMIC_EVIDENCE_SCHEMA_VERSION;
  evidenceId: string;
  organizationId: string;
  campaignId: string;
  hypothesisRef: string | null;
  candidateRef: string | null;
  dimension: EpistemicEvidenceDimension;
  direction: EpistemicEvidenceDirection;
  strength: string;
  uncertaintyBandLow: string;
  uncertaintyBandHigh: string;
  contradictionRefs: readonly string[];
  sourceRunDigest: string;
  relevanceScore: string;
  rationaleJson: string;
  contentDigest: string;
  createdAt: string;
};

export type AppendEvidenceRecordInput = {
  organizationId: string;
  campaignId: string;
  hypothesisRef?: string | null;
  candidateRef?: string | null;
  dimension: EpistemicEvidenceDimension;
  direction: EpistemicEvidenceDirection;
  strength: string;
  uncertaintyBandLow: string;
  uncertaintyBandHigh: string;
  contradictionRefs?: readonly string[];
  sourceRunDigest: string;
  relevanceScore: string;
  rationaleJson: string;
};

export type DeriveEvidenceFromMetricsInput = {
  organizationId: string;
  campaignId: string;
  candidateRef: string;
  sourceRunDigest: string;
  observedRegimeLabels: readonly string[];
  satisfiesMultiRegimeCoverage: boolean;
  blindConsumed: boolean;
  walkForwardWindowCount: number;
  closedTradeCount: number;
  builderGitSha: string | null;
  metricsSchemaVersion: string;
};
