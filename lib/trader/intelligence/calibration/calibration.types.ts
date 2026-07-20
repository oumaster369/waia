import type { CalibrationNonScoringReason } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import type { OutcomeProvenance } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";

export const CALIBRATION_OBSERVATION_SCHEMA_VERSION =
  "waia.trader.calibration_observation_record.v1" as const;
export const CALIBRATION_SNAPSHOT_SCHEMA_VERSION =
  "waia.trader.calibration_snapshot_record.v1" as const;

export const calibrationStatusEnum = ["AUTHORITATIVE", "INSUFFICIENT_CALIBRATION"] as const;

export type CalibrationStatus = (typeof calibrationStatusEnum)[number];

export type CalibrationPartitionKey = Readonly<{
  forecastModelVersion: string;
  regime: string;
  horizon: string;
}>;

export type CalibrationObservationRecord = Readonly<{
  id: string;
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  forecastRecordId: string;
  forecastOutcomeId: string;
  modelVersion: string;
  strategyVersion: string | null;
  regime: string;
  horizon: string;
  issuedAt: string;
  eligibleResolutionAt: string;
  resolvedAt: string;
  pitEvidenceBoundary: string;
  probability: string | null;
  outcomeEncoding: "1" | "0" | null;
  brierScore: string | null;
  logLossScore: string | null;
  scoringEligible: boolean;
  nonScoringReason: CalibrationNonScoringReason | null;
  contentDigest: string;
  idempotencyKey: string;
  provenance: OutcomeProvenance;
  terminalReason: string;
  schemaVersion: typeof CALIBRATION_OBSERVATION_SCHEMA_VERSION;
}>;

export type CalibrationSnapshotRecord = Readonly<{
  id: string;
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  forecastModelVersion: string;
  regime: string;
  horizon: string;
  sampleCount: number;
  scoringSampleCount: number;
  brierMean: string | null;
  logLossMean: string | null;
  calibrationStatus: CalibrationStatus;
  calibrationWindow: string;
  survivorshipCountsJson: string;
  issuedAt: string;
  eligibleResolutionAt: string;
  resolvedAt: string;
  pitEvidenceBoundary: string;
  outcomeClass: "SNAPSHOT";
  score: string | null;
  contentDigest: string;
  idempotencyKey: string;
  provenance: OutcomeProvenance;
  terminalReason: string;
  schemaVersion: typeof CALIBRATION_SNAPSHOT_SCHEMA_VERSION;
}>;

export type CalibrationObservationRepository = Readonly<{
  findByForecastOutcomeId(
    context: import("@/lib/waia-core/scope/org-context").OrgContext,
    forecastOutcomeId: string,
  ): Promise<CalibrationObservationRecord | null>;
  insert(
    context: import("@/lib/waia-core/scope/org-context").OrgContext,
    record: CalibrationObservationRecord,
  ): Promise<void>;
  listForRun(
    context: import("@/lib/waia-core/scope/org-context").OrgContext,
    runId: string,
  ): Promise<readonly CalibrationObservationRecord[]>;
}>;

export type CalibrationSnapshotRepository = Readonly<{
  findByPartition(
    context: import("@/lib/waia-core/scope/org-context").OrgContext,
    runId: string,
    partition: CalibrationPartitionKey,
  ): Promise<CalibrationSnapshotRecord | null>;
  insert(
    context: import("@/lib/waia-core/scope/org-context").OrgContext,
    record: CalibrationSnapshotRecord,
  ): Promise<void>;
  listForRun(
    context: import("@/lib/waia-core/scope/org-context").OrgContext,
    runId: string,
  ): Promise<readonly CalibrationSnapshotRecord[]>;
}>;

export type CalibrationSink = Readonly<{
  observationRepository: CalibrationObservationRepository;
  snapshotRepository: CalibrationSnapshotRepository;
}>;
