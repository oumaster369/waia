/**
 * HTR-WP21 — explicit authority boundaries between forecast calibration and knowledge confidence.
 * Machine outputs are evidence-only; operator judgment and lifecycle promotion remain human-gated.
 */

export const EPISTEMIC_AUTHORITY_CLASS = {
  evidenceOnly: "EVIDENCE_ONLY",
  runLocalEvidenceObservationOnly: "RUN_LOCAL_EVIDENCE_OBSERVATION_ONLY",
} as const;

export type EpistemicAuthorityClass =
  (typeof EPISTEMIC_AUTHORITY_CLASS)[keyof typeof EPISTEMIC_AUTHORITY_CLASS];

export const EPISTEMIC_OPERATOR_DISPOSITION = {
  pending: "PENDING",
} as const;

export type EpistemicOperatorDisposition =
  (typeof EPISTEMIC_OPERATOR_DISPOSITION)[keyof typeof EPISTEMIC_OPERATOR_DISPOSITION];

export const EPISTEMIC_DOWNSTREAM_AUTHORITY = {
  none: "NONE",
} as const;

export type EpistemicDownstreamAuthority =
  (typeof EPISTEMIC_DOWNSTREAM_AUTHORITY)[keyof typeof EPISTEMIC_DOWNSTREAM_AUTHORITY];

export const KNOWLEDGE_CONFIDENCE_VALUE_CLASS = {
  machineRecommendedBoundedDelta: "MACHINE_RECOMMENDED_BOUNDED_DELTA",
  derivedStalenessEvidence: "DERIVED_STALENESS_EVIDENCE",
} as const;

export type KnowledgeConfidenceValueClass =
  (typeof KNOWLEDGE_CONFIDENCE_VALUE_CLASS)[keyof typeof KNOWLEDGE_CONFIDENCE_VALUE_CLASS];

export const FORECAST_CALIBRATION_SCORE_CLASS = {
  brier: "BRIER_SCORE",
  logLoss: "LOG_LOSS_SCORE",
} as const;

export type ForecastCalibrationScoreClass =
  (typeof FORECAST_CALIBRATION_SCORE_CLASS)[keyof typeof FORECAST_CALIBRATION_SCORE_CLASS];

export const WP21_EPISTEMIC_AUTHORITY_DEFAULTS = {
  knowledgeUpdate: {
    authorityClass: EPISTEMIC_AUTHORITY_CLASS.evidenceOnly,
    operatorDisposition: EPISTEMIC_OPERATOR_DISPOSITION.pending,
    capitalAuthority: EPISTEMIC_DOWNSTREAM_AUTHORITY.none,
    strategyAuthority: EPISTEMIC_DOWNSTREAM_AUTHORITY.none,
    tradeEligibilityAuthority: EPISTEMIC_DOWNSTREAM_AUTHORITY.none,
    guardianAuthority: EPISTEMIC_DOWNSTREAM_AUTHORITY.none,
  },
  hypothesisOutcome: {
    authorityClass: EPISTEMIC_AUTHORITY_CLASS.runLocalEvidenceObservationOnly,
    operatorDisposition: EPISTEMIC_OPERATOR_DISPOSITION.pending,
    hypothesisLifecycleAuthority: EPISTEMIC_DOWNSTREAM_AUTHORITY.none,
    strategyPromotionAuthority: EPISTEMIC_DOWNSTREAM_AUTHORITY.none,
    validatedKnowledgeAuthority: EPISTEMIC_DOWNSTREAM_AUTHORITY.none,
  },
} as const;
