export const CYCLE_ENVELOPE_SCHEMA_VERSION = "waia.trader.intelligence_cycle_envelope.v1" as const;
export const HYPOTHESIS_RECORD_SCHEMA_VERSION =
  "waia.trader.intelligence_hypothesis_record.v1" as const;
export const CONVICTION_RECORD_SCHEMA_VERSION =
  "waia.trader.intelligence_conviction_record.v1" as const;

export type ConvictionScope = "ACTIVE_HYPOTHESIS" | "NONE";

export type TraderIntelligenceCycleEnvelopeRecord = Readonly<{
  id: string;
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  evaluatedAt: string;
  historicalProfileId: string;
  historicalProfileDigest: string;
  matrixDigest: string;
  terminalReasonCode: string;
  inputSemanticDigest: string;
  outputSemanticDigest: string;
  contentDigest: string;
  schemaVersion: typeof CYCLE_ENVELOPE_SCHEMA_VERSION;
}>;

export type TraderIntelligenceHypothesisRecord = Readonly<{
  id: string;
  organizationId: string;
  cycleEnvelopeId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  evaluatedAt: string;
  hypothesisType: string;
  hypothesisStatus: string;
  confidenceValue: string;
  thesisDigest: string;
  evidenceDigest: string;
  miHypothesisId: string | null;
  authoritativeLinkDigest: string;
  contentDigest: string;
  schemaVersion: typeof HYPOTHESIS_RECORD_SCHEMA_VERSION;
}>;

export type TraderIntelligenceConvictionRecord = Readonly<{
  id: string;
  organizationId: string;
  cycleEnvelopeId: string;
  activeHypothesisRecordId: string | null;
  convictionScope: ConvictionScope;
  runId: string;
  cycleId: string;
  symbol: string;
  evaluatedAt: string;
  convictionValue: string;
  convictionClass: string;
  reasonCodes: readonly string[];
  sustainedCycles: number;
  contentDigest: string;
  schemaVersion: typeof CONVICTION_RECORD_SCHEMA_VERSION;
}>;

export type IntelligenceCycleBundle = Readonly<{
  envelope: TraderIntelligenceCycleEnvelopeRecord;
  hypotheses: readonly TraderIntelligenceHypothesisRecord[];
  conviction: TraderIntelligenceConvictionRecord;
  informationSufficiencyProvenance: Readonly<{
    accountId: string | null;
    analyticalTimeframe: string;
  }>;
}>;
