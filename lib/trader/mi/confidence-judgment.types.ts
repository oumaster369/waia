import {
  deriveTrialIntegrityState,
  type MiTrialIntegrityEvent,
  type MiTrialIntegrityState,
} from "@/lib/trader/mi/trial-integrity.types";
import type {
  MiHypothesisLifecycleEvent,
  MiHypothesisLifecycleState,
} from "@/lib/trader/mi/hypothesis.types";

export const MI_CONFIDENCE_JUDGMENT_SCHEMA_VERSION = "mi-confidence-judgment-v1" as const;

export type MiConfidenceJudgmentSchemaVersion = typeof MI_CONFIDENCE_JUDGMENT_SCHEMA_VERSION;

export const MI_CONFIDENCE_SCALE_V1 = "mi-confidence-scale-v1" as const;

export type MiConfidenceScaleVersion = typeof MI_CONFIDENCE_SCALE_V1;

export const miConfidenceLevelV1Values = [
  "speculative",
  "tentative",
  "supported",
  "strong",
  "compelling",
] as const;

export type MiConfidenceLevelV1 = (typeof miConfidenceLevelV1Values)[number];

export const miConfidenceJudgmentKindValues = ["asserted", "insufficiency_attested"] as const;

export type MiConfidenceJudgmentKind = (typeof miConfidenceJudgmentKindValues)[number];

export const miConfidenceEligibilityReasonValues = [
  "NO_JUDGMENT",
  "WITHDRAWN",
  "EXPIRED",
  "CITATION_INVALIDATED",
  "LIFECYCLE_BLOCKED",
] as const;

export type MiConfidenceEligibilityReason = (typeof miConfidenceEligibilityReasonValues)[number];

export const miConfidenceEligibilityVerdictValues = ["ELIGIBLE", "INELIGIBLE"] as const;

export type MiConfidenceEligibilityVerdict = (typeof miConfidenceEligibilityVerdictValues)[number];

export const miConfidenceSignalClassValues = [
  "NEW_DISCONFIRMING_EVIDENCE",
  "NEW_CORROBORATING_EVIDENCE",
  "NEWER_HYPOTHESIS_VERSION_AVAILABLE",
  "EXPIRING_SOON",
] as const;

export type MiConfidenceSignalClass = (typeof miConfidenceSignalClassValues)[number];

export const MI_CONFIDENCE_DERIVATION_VERSION = "mi-confidence-derivation-v1" as const;

/** Advisory window before review horizon lapses (signal only). */
export const MI_CONFIDENCE_EXPIRING_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const CONFIDENCE_LEVEL_RANK_V1: Record<MiConfidenceLevelV1, number> = {
  speculative: 1,
  tentative: 2,
  supported: 3,
  strong: 4,
  compelling: 5,
};

export type MiConfidenceJudgmentCitation = {
  evidenceId: string;
  evidenceContentDigest: string;
};

/** Append-only Confidence Judgment record (DEE-293 / LD-5a.3a). */
export type MiConfidenceJudgment = {
  id: string;
  organizationId: string;
  hypothesisId: string;
  hypothesisKey: string;
  hypothesisDefinitionDigest: string;
  level: MiConfidenceLevelV1 | null;
  bandLow: MiConfidenceLevelV1 | null;
  bandHigh: MiConfidenceLevelV1 | null;
  confidenceScaleVersion: MiConfidenceScaleVersion | null;
  judgmentKind: MiConfidenceJudgmentKind;
  reviewHorizonAt: Date | null;
  forCitations: readonly MiConfidenceJudgmentCitation[];
  eventTime: Date;
  ingestTime: Date;
  recordedBy: string;
  seq: number;
  contentDigest: string;
  schemaVersion: MiConfidenceJudgmentSchemaVersion;
  createdAt: Date;
};

export type MiConfidenceEligibilityResult = {
  verdict: MiConfidenceEligibilityVerdict;
  reasons: readonly MiConfidenceEligibilityReason[];
  asOf: Date;
  derivationVersionId: typeof MI_CONFIDENCE_DERIVATION_VERSION;
  hypothesisId: string;
};

export type MiConfidenceSignal = {
  signalClass: MiConfidenceSignalClass;
  asOf: Date;
  derivationVersionId: typeof MI_CONFIDENCE_DERIVATION_VERSION;
};

export type MiConfidenceSignalsResult = {
  signals: readonly MiConfidenceSignal[];
  asOf: Date;
  derivationVersionId: typeof MI_CONFIDENCE_DERIVATION_VERSION;
  hypothesisId: string;
};

export type RecordConfidenceJudgmentInput = {
  hypothesisId: string;
  hypothesisDefinitionDigest: string;
  judgmentKind: MiConfidenceJudgmentKind;
  level?: MiConfidenceLevelV1;
  bandLow?: MiConfidenceLevelV1;
  bandHigh?: MiConfidenceLevelV1;
  confidenceScaleVersion?: MiConfidenceScaleVersion;
  reviewHorizonAt?: Date | null;
  forCitations?: readonly MiConfidenceJudgmentCitation[];
  eventTime: Date;
  ingestTime: Date;
  recordedBy: string;
};

export function isMiConfidenceLevelV1(value: string): value is MiConfidenceLevelV1 {
  return (miConfidenceLevelV1Values as readonly string[]).includes(value);
}

export function isMiConfidenceJudgmentKind(value: string): value is MiConfidenceJudgmentKind {
  return (miConfidenceJudgmentKindValues as readonly string[]).includes(value);
}

export function getConfidenceLevelRankV1(level: MiConfidenceLevelV1): number {
  return CONFIDENCE_LEVEL_RANK_V1[level];
}

export function assertConfidenceBandOrderingV1(
  level: MiConfidenceLevelV1,
  bandLow: MiConfidenceLevelV1,
  bandHigh: MiConfidenceLevelV1,
): void {
  const levelRank = getConfidenceLevelRankV1(level);
  const lowRank = getConfidenceLevelRankV1(bandLow);
  const highRank = getConfidenceLevelRankV1(bandHigh);
  if (lowRank > levelRank || levelRank > highRank) {
    throw new Error(
      "MI_CONFIDENCE_BAND_INVALID: bandLow <= level <= bandHigh required for mi-confidence-scale-v1",
    );
  }
}

export function filterVisibleByIngestTime<T extends { ingestTime: Date }>(
  rows: readonly T[],
  asOf: Date,
): T[] {
  const asOfMs = asOf.getTime();
  return rows.filter((row) => row.ingestTime.getTime() <= asOfMs);
}

export function deriveHypothesisLifecycleStateAsOf(
  events: readonly MiHypothesisLifecycleEvent[],
  asOf: Date,
): MiHypothesisLifecycleState | null {
  const asOfMs = asOf.getTime();
  const visible = events.filter((event) => event.createdAt.getTime() <= asOfMs);
  if (visible.length === 0) return null;
  return visible[visible.length - 1]!.lifecycleState;
}

export function deriveTrialIntegrityStateAsOf(
  events: readonly MiTrialIntegrityEvent[],
  asOf: Date,
): MiTrialIntegrityState {
  return deriveTrialIntegrityState(filterVisibleByIngestTime(events, asOf));
}

export function selectLatestConfidenceJudgmentForVersion(
  judgments: readonly MiConfidenceJudgment[],
  hypothesisId: string,
  asOf: Date,
): MiConfidenceJudgment | null {
  const visible = filterVisibleByIngestTime(judgments, asOf).filter(
    (row) => row.hypothesisId === hypothesisId,
  );
  if (visible.length === 0) return null;
  return visible.reduce((latest, row) => (row.seq > latest.seq ? row : latest));
}

export type DeriveConfidenceEligibilityInput = {
  hypothesisId: string;
  asOf: Date;
  latestJudgment: MiConfidenceJudgment | null;
  lifecycleState: MiHypothesisLifecycleState | null;
  citationIntegrityInvalidated: boolean;
};

export function deriveConfidenceEligibility(
  input: DeriveConfidenceEligibilityInput,
): MiConfidenceEligibilityResult {
  const reasons: MiConfidenceEligibilityReason[] = [];
  const asOfMs = input.asOf.getTime();

  if (!input.latestJudgment) {
    reasons.push("NO_JUDGMENT");
  } else {
    if (input.latestJudgment.judgmentKind === "insufficiency_attested") {
      reasons.push("WITHDRAWN");
    }
    if (
      input.latestJudgment.reviewHorizonAt !== null &&
      input.latestJudgment.reviewHorizonAt.getTime() < asOfMs
    ) {
      reasons.push("EXPIRED");
    }
    if (input.citationIntegrityInvalidated) {
      reasons.push("CITATION_INVALIDATED");
    }
  }

  if (input.lifecycleState === "RETIRED" || input.lifecycleState === "QUARANTINED") {
    reasons.push("LIFECYCLE_BLOCKED");
  }

  return {
    verdict: reasons.length > 0 ? "INELIGIBLE" : "ELIGIBLE",
    reasons,
    asOf: input.asOf,
    derivationVersionId: MI_CONFIDENCE_DERIVATION_VERSION,
    hypothesisId: input.hypothesisId,
  };
}

export type DeriveConfidenceSignalsInput = {
  hypothesisId: string;
  hypothesisKey: string;
  asOf: Date;
  latestJudgment: MiConfidenceJudgment | null;
  hasNewDisconfirmingEvidence: boolean;
  hasNewCorroboratingEvidence: boolean;
  hasNewerHypothesisVersion: boolean;
  expiringSoon: boolean;
};

export function deriveConfidenceSignals(
  input: DeriveConfidenceSignalsInput,
): MiConfidenceSignalsResult {
  const signals: MiConfidenceSignal[] = [];
  const base = {
    asOf: input.asOf,
    derivationVersionId: MI_CONFIDENCE_DERIVATION_VERSION,
  } as const;

  if (input.hasNewDisconfirmingEvidence) {
    signals.push({ signalClass: "NEW_DISCONFIRMING_EVIDENCE", ...base });
  }
  if (input.hasNewCorroboratingEvidence) {
    signals.push({ signalClass: "NEW_CORROBORATING_EVIDENCE", ...base });
  }
  if (input.hasNewerHypothesisVersion) {
    signals.push({ signalClass: "NEWER_HYPOTHESIS_VERSION_AVAILABLE", ...base });
  }
  if (input.expiringSoon) {
    signals.push({ signalClass: "EXPIRING_SOON", ...base });
  }

  return {
    signals,
    asOf: input.asOf,
    derivationVersionId: MI_CONFIDENCE_DERIVATION_VERSION,
    hypothesisId: input.hypothesisId,
  };
}

export function signalsMustNotGateEligibility(
  eligibility: MiConfidenceEligibilityResult,
  signals: MiConfidenceSignalsResult,
): boolean {
  if (signals.signals.length === 0) return true;
  const gateReasons = new Set(eligibility.reasons);
  for (const signal of signals.signals) {
    if (gateReasons.has(signal.signalClass as MiConfidenceEligibilityReason)) {
      return false;
    }
  }
  return true;
}
