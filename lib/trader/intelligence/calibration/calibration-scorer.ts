import { createHash } from "node:crypto";

import {
  canonicalizeSemanticJsonString,
  computeSemanticSha256Hex,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  EPISTEMIC_CALIBRATION_WINDOW,
  EPISTEMIC_MIN_CALIBRATION_SAMPLES,
} from "@/lib/trader/intelligence/epistemic/epistemic-scoring-contract";
import {
  computeBrierScore,
  validateProbabilityDomain,
} from "@/lib/trader/intelligence/calibration/brier-score";
import { computeLogLoss } from "@/lib/trader/intelligence/calibration/log-loss";
import type {
  CalibrationObservationRecord,
  CalibrationPartitionKey,
  CalibrationSnapshotRecord,
} from "@/lib/trader/intelligence/calibration/calibration.types";
import {
  CALIBRATION_OBSERVATION_SCHEMA_VERSION,
  CALIBRATION_SNAPSHOT_SCHEMA_VERSION,
} from "@/lib/trader/intelligence/calibration/calibration.types";
import {
  computeCalibrationObservationContentDigest,
  computeCalibrationSnapshotContentDigest,
} from "@/lib/trader/intelligence/calibration/serialize-calibration";
import type { ForecastOutcomeRecord } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import type { TraderIntelligenceForecastRecord } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type { CalibrationNonScoringReason } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import type { OutcomeProvenance } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import {
  requireForecastRuntimeAuthorizedOutcomeV2,
  type ForecastRuntimeAuthorizedOutcomeV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { bucketIndexForReturn } from "@/lib/trader/research/benchmark/target-grid-ceremony-v1";

export const FORECAST_V2_MULTICLASS_SCORING_VERSION =
  "waia.trader.forecast_v2_multiclass_scoring.v1" as const;
export const FORECAST_V2_LOG_LOSS_FLOOR = 1e-15;

export type ForecastV2ObjectiveEvidence = Readonly<{
  organizationId: string;
  symbol: string;
  primaryHorizonMinutes: number;
  anchorClosedBarEpochMs: number;
  resolvedAt: string;
  pitEvidenceBoundary: string;
  observedTerminalReturn: number;
  observedOutcomeDigestHex: string;
  pitMeasurementIdentityDigestHex: string;
  knowledgeEdgeId: string;
  knowledgeContentDigestHex: string;
}>;

export type ForecastV2CalibrationObservation = Readonly<{
  schemaVersion: typeof FORECAST_V2_MULTICLASS_SCORING_VERSION;
  organizationId: string;
  symbol: string;
  primaryHorizonMinutes: number;
  anchorClosedBarEpochMs: number;
  resolvedAt: string;
  pitEvidenceBoundary: string;
  observedBucketOrdinal: number;
  probabilities: readonly number[];
  normalizedBrierScore: string;
  logLossScore: string;
  forecastRuntimeAuthorityContentDigestHex: string;
  predictivePackageContentDigestHex: string;
  terminalTargetDefinitionDigestHex: string;
  terminalDistributionSemanticDigestHex: string;
  terminalForecastContentDigestHex: string;
  observedOutcomeDigestHex: string;
  pitMeasurementIdentityDigestHex: string;
  knowledgeEdgeId: string;
  knowledgeContentDigestHex: string;
  scoringEligible: true;
  capitalAuthority: "NONE";
  idempotencyKey: string;
  contentDigest: string;
}>;

function requireDigestHex(value: string, field: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`FORECAST_V2_CALIBRATION_INVALID_${field}`);
  }
}

function canonicalFullPrecisionDecimal(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("FORECAST_V2_CALIBRATION_NON_FINITE_SCORE");
  }
  return Object.is(value, -0) ? "0" : value.toString();
}

export function scoreForecastV2MulticlassObservation(input: {
  authorizedOutcome: ForecastRuntimeAuthorizedOutcomeV2;
  objectiveEvidence: ForecastV2ObjectiveEvidence;
}): ForecastV2CalibrationObservation {
  const authorized = requireForecastRuntimeAuthorizedOutcomeV2(input.authorizedOutcome);
  const { authority, issuance } = authorized;
  const evidence = input.objectiveEvidence;
  requireDigestHex(evidence.observedOutcomeDigestHex, "OUTCOME_DIGEST");
  requireDigestHex(evidence.pitMeasurementIdentityDigestHex, "PIT_DIGEST");
  requireDigestHex(evidence.knowledgeContentDigestHex, "KNOWLEDGE_DIGEST");
  if (!evidence.knowledgeEdgeId.trim()) {
    throw new Error("FORECAST_V2_CALIBRATION_MISSING_KNOWLEDGE_EDGE");
  }
  if (
    evidence.organizationId !== authority.organizationId ||
    evidence.organizationId !== issuance.organizationId ||
    evidence.symbol !== issuance.package.family.symbol ||
    evidence.primaryHorizonMinutes !== issuance.package.family.primaryHorizonMinutes ||
    evidence.anchorClosedBarEpochMs !== authority.anchorClosedBarEpochMs ||
    evidence.anchorClosedBarEpochMs !== issuance.anchorClosedBarEpochMs ||
    evidence.knowledgeEdgeId !== authority.knowledgeEdgeId ||
    evidence.knowledgeContentDigestHex !== authority.knowledgeContentDigestHex
  ) {
    throw new Error("FORECAST_V2_CALIBRATION_IDENTITY_MISMATCH");
  }
  const resolvedAtMs = Date.parse(evidence.resolvedAt);
  const pitBoundaryMs = Date.parse(evidence.pitEvidenceBoundary);
  const eligibleAtMs =
    evidence.anchorClosedBarEpochMs + (evidence.primaryHorizonMinutes + 3) * 60_000;
  if (
    !Number.isFinite(resolvedAtMs) ||
    !Number.isFinite(pitBoundaryMs) ||
    pitBoundaryMs < eligibleAtMs ||
    pitBoundaryMs > resolvedAtMs ||
    resolvedAtMs < eligibleAtMs ||
    !Number.isFinite(evidence.observedTerminalReturn)
  ) {
    throw new Error("FORECAST_V2_CALIBRATION_PIT_MISMATCH");
  }
  const probabilities = [...issuance.terminalScenarioMasses.probabilities];
  if (
    probabilities.length !== 7 ||
    probabilities.some((value) => !Number.isFinite(value) || value < 0 || value > 1) ||
    Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) > 1e-12
  ) {
    throw new Error("FORECAST_V2_CALIBRATION_PROBABILITY_VECTOR_INVALID");
  }
  if (
    issuance.terminalScenarioMasses.gridIdentityDigestHex !==
    issuance.package.terminalTargetGridIdentityDigestHex
  ) {
    throw new Error("FORECAST_V2_CALIBRATION_TARGET_GRID_MISMATCH");
  }
  const observedBucketOrdinal = bucketIndexForReturn(
    evidence.observedTerminalReturn,
    issuance.terminalScenarioMasses.grid,
  );
  const normalizedBrier =
    0.5 *
    probabilities.reduce(
      (sum, probability, ordinal) =>
        sum + (probability - (ordinal === observedBucketOrdinal ? 1 : 0)) ** 2,
      0,
    );
  const logLoss = -Math.log(
    Math.max(probabilities[observedBucketOrdinal]!, FORECAST_V2_LOG_LOSS_FLOOR),
  );
  const base = {
    schemaVersion: FORECAST_V2_MULTICLASS_SCORING_VERSION,
    organizationId: evidence.organizationId,
    symbol: evidence.symbol,
    primaryHorizonMinutes: evidence.primaryHorizonMinutes,
    anchorClosedBarEpochMs: evidence.anchorClosedBarEpochMs,
    resolvedAt: evidence.resolvedAt,
    pitEvidenceBoundary: evidence.pitEvidenceBoundary,
    observedBucketOrdinal,
    probabilities,
    normalizedBrierScore: canonicalFullPrecisionDecimal(normalizedBrier),
    logLossScore: canonicalFullPrecisionDecimal(logLoss),
    forecastRuntimeAuthorityContentDigestHex: authority.contentDigestHex,
    predictivePackageContentDigestHex: authority.selectedPredictivePackageContentDigestHex,
    terminalTargetDefinitionDigestHex: authority.terminalTargetDefinitionDigestHex,
    terminalDistributionSemanticDigestHex: authority.terminalDistributionSemanticDigestHex,
    terminalForecastContentDigestHex: authority.terminalForecastContentDigestHex,
    observedOutcomeDigestHex: evidence.observedOutcomeDigestHex,
    pitMeasurementIdentityDigestHex: evidence.pitMeasurementIdentityDigestHex,
    knowledgeEdgeId: evidence.knowledgeEdgeId,
    knowledgeContentDigestHex: evidence.knowledgeContentDigestHex,
    scoringEligible: true as const,
    capitalAuthority: "NONE" as const,
    idempotencyKey: [
      FORECAST_V2_MULTICLASS_SCORING_VERSION,
      evidence.organizationId,
      authority.terminalForecastContentDigestHex,
      evidence.observedOutcomeDigestHex,
    ].join("|"),
  };
  return { ...base, contentDigest: computeSemanticSha256Hex(base) };
}

export function requireForecastV2CalibrationObservation(
  value: ForecastV2CalibrationObservation,
): ForecastV2CalibrationObservation {
  const { contentDigest, ...body } = value;
  const probabilities = [...value.probabilities];
  const expectedBrier =
    0.5 *
    probabilities.reduce(
      (sum, probability, ordinal) =>
        sum + (probability - (ordinal === value.observedBucketOrdinal ? 1 : 0)) ** 2,
      0,
    );
  const expectedLogLoss = -Math.log(
    Math.max(probabilities[value.observedBucketOrdinal] ?? Number.NaN, FORECAST_V2_LOG_LOSS_FLOOR),
  );
  if (
    value.schemaVersion !== FORECAST_V2_MULTICLASS_SCORING_VERSION ||
    value.scoringEligible !== true ||
    value.capitalAuthority !== "NONE" ||
    probabilities.length !== 7 ||
    probabilities.some((probability) => !Number.isFinite(probability) || probability < 0 || probability > 1) ||
    Math.abs(probabilities.reduce((sum, probability) => sum + probability, 0) - 1) > 1e-12 ||
    !Number.isInteger(value.observedBucketOrdinal) ||
    value.observedBucketOrdinal < 0 ||
    value.observedBucketOrdinal > 6 ||
    value.normalizedBrierScore !== canonicalFullPrecisionDecimal(expectedBrier) ||
    value.logLossScore !== canonicalFullPrecisionDecimal(expectedLogLoss) ||
    computeSemanticSha256Hex(body) !== contentDigest
  ) {
    throw new Error("FORECAST_V2_CALIBRATION_OBSERVATION_INVALID");
  }
  for (const [field, digest] of Object.entries(value).filter(([key]) =>
    key.endsWith("DigestHex"),
  )) {
    requireDigestHex(String(digest), field);
  }
  return value;
}

function deriveDeterministicUuidV4(seed: string): string {
  const hash = createHash("sha256").update(seed, "utf8").digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function parseConfidenceValue(forecastConfidenceJson: string): string | null {
  try {
    const parsed = JSON.parse(forecastConfidenceJson) as { confidence_value?: string | number };
    if (parsed.confidence_value === undefined || parsed.confidence_value === null) {
      return null;
    }
    return String(parsed.confidence_value);
  } catch {
    return null;
  }
}

function resolveNonScoringReason(
  outcome: ForecastOutcomeRecord,
): CalibrationNonScoringReason | null {
  switch (outcome.outcomeClass) {
    case "EXPIRED":
      return "EXPIRED_NO_DIRECTIONAL_CONFIRMATION";
    case "INVALIDATED":
      return "DECLARED_INVALIDATION_FIRED";
    case "UNRESOLVED_DUE_TO_DATA_INTEGRITY":
      return "UNRESOLVED_DUE_TO_DATA_INTEGRITY";
    default:
      return null;
  }
}

export function scoreForecastCalibrationObservation(input: {
  context: OrgContext;
  forecast: TraderIntelligenceForecastRecord;
  outcome: ForecastOutcomeRecord;
  provenance: OutcomeProvenance;
}): CalibrationObservationRecord {
  const probability = parseConfidenceValue(input.forecast.forecastConfidenceJson);
  let scoringEligible = false;
  let nonScoringReason = resolveNonScoringReason(input.outcome);
  let outcomeEncoding: "1" | "0" | null = null;
  let brierScore: string | null = null;
  let logLossScore: string | null = null;

  if (input.outcome.outcomeClass === "RESOLVED" && input.outcome.outcomeVerdict) {
    if (!probability || !validateProbabilityDomain(probability)) {
      nonScoringReason = "INVALID_PROBABILITY";
    } else {
      outcomeEncoding = input.outcome.outcomeVerdict === "CORRECT" ? "1" : "0";
      brierScore = computeBrierScore(probability, outcomeEncoding);
      logLossScore = computeLogLoss(probability, outcomeEncoding);
      scoringEligible = true;
      nonScoringReason = null;
    }
  }

  const id = deriveDeterministicUuidV4(
    `${CALIBRATION_OBSERVATION_SCHEMA_VERSION}|${input.context.organizationId}|${input.outcome.id}`,
  );
  const idempotencyKey = [
    CALIBRATION_OBSERVATION_SCHEMA_VERSION,
    input.context.organizationId,
    input.outcome.id,
  ].join("|");

  const base: Omit<CalibrationObservationRecord, "contentDigest"> = {
    id,
    organizationId: input.context.organizationId,
    runId: input.outcome.runId,
    cycleId: input.outcome.cycleId,
    symbol: input.outcome.symbol,
    forecastRecordId: input.forecast.id,
    forecastOutcomeId: input.outcome.id,
    modelVersion: input.outcome.modelVersion,
    strategyVersion: input.outcome.strategyVersion,
    regime: input.outcome.regime,
    horizon: input.outcome.horizon,
    issuedAt: input.outcome.issuedAt,
    eligibleResolutionAt: input.outcome.eligibleResolutionAt,
    resolvedAt:
      input.outcome.resolvedAt ?? input.outcome.pitEvidenceBoundary ?? input.outcome.issuedAt,
    pitEvidenceBoundary:
      input.outcome.pitEvidenceBoundary ?? input.outcome.resolvedAt ?? input.outcome.issuedAt,
    probability,
    outcomeEncoding,
    brierScore,
    logLossScore,
    scoringEligible,
    nonScoringReason,
    idempotencyKey,
    provenance: input.provenance,
    terminalReason: scoringEligible ? "SCORED" : (nonScoringReason ?? "NON_SCORING"),
    schemaVersion: CALIBRATION_OBSERVATION_SCHEMA_VERSION,
  };

  const draft = { ...base, contentDigest: "" };
  return {
    ...draft,
    contentDigest: computeCalibrationObservationContentDigest(draft),
  };
}

export function buildCalibrationSnapshots(input: {
  context: OrgContext;
  runId: string;
  asOf: string;
  observations: readonly CalibrationObservationRecord[];
  provenance: OutcomeProvenance;
}): readonly CalibrationSnapshotRecord[] {
  const partitions = new Map<string, CalibrationObservationRecord[]>();

  for (const observation of input.observations) {
    const key = [observation.modelVersion, observation.regime, observation.horizon].join("|");
    const bucket = partitions.get(key) ?? [];
    bucket.push(observation);
    partitions.set(key, bucket);
  }

  const snapshots: CalibrationSnapshotRecord[] = [];

  for (const [key, bucket] of partitions.entries()) {
    const [forecastModelVersion, regime, horizon] = key.split("|") as [string, string, string];
    const partition: CalibrationPartitionKey = { forecastModelVersion, regime, horizon };

    const sampleCount = bucket.length;
    const scoring = bucket.filter((row) => row.scoringEligible);
    const scoringSampleCount = scoring.length;
    const brierScores = scoring.map((row) => row.brierScore!).filter(Boolean);
    const logLossScores = scoring.map((row) => row.logLossScore!).filter(Boolean);

    const brierMean =
      brierScores.length > 0
        ? brierScores.reduce((acc, score, index) => {
            if (index === 0) {
              return score;
            }
            return String((Number(acc) + Number(score)) / (index + 1));
          }, "0")
        : null;

    const logLossMean =
      logLossScores.length > 0
        ? logLossScores.reduce((acc, score, index) => {
            if (index === 0) {
              return score;
            }
            return String((Number(acc) + Number(score)) / (index + 1));
          }, "0")
        : null;

    const survivorshipCounts: Record<string, number> = {};
    for (const row of bucket) {
      const reason = row.nonScoringReason ?? (row.scoringEligible ? "SCORED" : "NON_SCORING");
      survivorshipCounts[reason] = (survivorshipCounts[reason] ?? 0) + 1;
    }

    const calibrationStatus =
      scoringSampleCount >= EPISTEMIC_MIN_CALIBRATION_SAMPLES
        ? "AUTHORITATIVE"
        : "INSUFFICIENT_CALIBRATION";

    const id = deriveDeterministicUuidV4(
      `${CALIBRATION_SNAPSHOT_SCHEMA_VERSION}|${input.context.organizationId}|${input.runId}|${forecastModelVersion}|${regime}|${horizon}`,
    );
    const idempotencyKey = [
      CALIBRATION_SNAPSHOT_SCHEMA_VERSION,
      input.context.organizationId,
      input.runId,
      forecastModelVersion,
      regime,
      horizon,
    ].join("|");

    const base: Omit<CalibrationSnapshotRecord, "contentDigest"> = {
      id,
      organizationId: input.context.organizationId,
      runId: input.runId,
      cycleId: "terminal",
      symbol: "*",
      forecastModelVersion,
      regime,
      horizon,
      sampleCount,
      scoringSampleCount,
      brierMean,
      logLossMean,
      calibrationStatus,
      calibrationWindow: EPISTEMIC_CALIBRATION_WINDOW,
      survivorshipCountsJson: canonicalizeSemanticJsonString(survivorshipCounts),
      issuedAt: input.asOf,
      eligibleResolutionAt: input.asOf,
      resolvedAt: input.asOf,
      pitEvidenceBoundary: input.asOf,
      outcomeClass: "SNAPSHOT",
      score: brierMean,
      idempotencyKey,
      provenance: input.provenance,
      terminalReason: calibrationStatus,
      schemaVersion: CALIBRATION_SNAPSHOT_SCHEMA_VERSION,
    };

    const draft = { ...base, contentDigest: "" };
    snapshots.push({
      ...draft,
      contentDigest: computeCalibrationSnapshotContentDigest(draft),
    });

    void partition;
  }

  return snapshots;
}
