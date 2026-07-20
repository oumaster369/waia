import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";

export class StrategyCandidateNotFoundError extends Error {
  readonly code = "STRATEGY_CANDIDATE_NOT_FOUND" as const;

  constructor(candidateId: string) {
    super(`[research] strategy candidate not found: ${candidateId}`);
    this.name = "StrategyCandidateNotFoundError";
  }
}

export class StrategyCandidateBlindLockoutError extends Error {
  readonly code = "STRATEGY_CANDIDATE_BLIND_LOCKOUT" as const;

  constructor(candidateId: string) {
    super(`[research] blind holdout already consumed for candidate ${candidateId}`);
    this.name = "StrategyCandidateBlindLockoutError";
  }
}

export class BlindValidationAlreadyExistsError extends Error {
  readonly code = "BLIND_VALIDATION_ALREADY_EXISTS" as const;

  constructor(candidateId: string) {
    super(
      `[research] immutable blind validation result already exists for candidate ${candidateId}`,
    );
    this.name = "BlindValidationAlreadyExistsError";
  }
}

export class WalkForwardValidationError extends Error {
  readonly code = "WALK_FORWARD_VALIDATION_ERROR" as const;

  constructor(message: string) {
    super(`[research] walk-forward validation failed: ${message}`);
    this.name = "WalkForwardValidationError";
  }
}

export class BlindHoldoutValidationError extends Error {
  readonly code = "BLIND_HOLDOUT_VALIDATION_ERROR" as const;

  constructor(message: string) {
    super(`[research] blind holdout validation failed: ${message}`);
    this.name = "BlindHoldoutValidationError";
  }
}

export class MultiRegimeCoverageError extends Error {
  readonly code = "MULTI_REGIME_COVERAGE_ERROR" as const;

  constructor(message: string) {
    super(`[research] multi-regime coverage requirement not met: ${message}`);
    this.name = "MultiRegimeCoverageError";
  }
}

/** Carries partial pipeline context when bundle regime coverage fails (SEE-A1). */
export class ResearchPipelineRegimeFailureError extends Error {
  readonly code = "RESEARCH_PIPELINE_REGIME_FAILURE" as const;
  readonly organizationId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly candidateId: string;
  readonly datasetId: string;
  readonly backtestRunId: string;
  readonly blindValidationResultId: string;
  readonly blindConsumed: boolean;
  readonly walkForwardWindowCount: number;
  readonly validationMetrics: ResearchValidationMetrics;
  readonly walkForwardMetrics: readonly ResearchValidationMetrics[];
  readonly blindMetrics: ResearchValidationMetrics;
  readonly coverageCause: MultiRegimeCoverageError;

  constructor(
    input: {
      organizationId: string;
      strategyId: string;
      strategyVersion: string;
      candidateId: string;
      datasetId: string;
      backtestRunId: string;
      blindValidationResultId: string;
      blindConsumed: boolean;
      walkForwardWindowCount: number;
      validationMetrics: ResearchValidationMetrics;
      walkForwardMetrics: readonly ResearchValidationMetrics[];
      blindMetrics: ResearchValidationMetrics;
    },
    coverageCause: MultiRegimeCoverageError,
  ) {
    super(coverageCause.message);
    this.name = "ResearchPipelineRegimeFailureError";
    this.organizationId = input.organizationId;
    this.strategyId = input.strategyId;
    this.strategyVersion = input.strategyVersion;
    this.candidateId = input.candidateId;
    this.datasetId = input.datasetId;
    this.backtestRunId = input.backtestRunId;
    this.blindValidationResultId = input.blindValidationResultId;
    this.blindConsumed = input.blindConsumed;
    this.walkForwardWindowCount = input.walkForwardWindowCount;
    this.validationMetrics = input.validationMetrics;
    this.walkForwardMetrics = input.walkForwardMetrics;
    this.blindMetrics = input.blindMetrics;
    this.coverageCause = coverageCause;
  }
}

export class ResearchEvidenceProvenanceError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "ResearchEvidenceProvenanceError";
    this.code = code;
  }
}

export class ResearchOrchestratorError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "ResearchOrchestratorError";
    this.code = code;
  }
}

export type ResearchFailureReconstructionErrorCode =
  | "CANDIDATE_NOT_FOUND"
  | "CANDIDATE_NOT_ELIGIBLE"
  | "BLIND_RESULT_NOT_FOUND"
  | "VALIDATION_BACKTEST_RUN_NOT_FOUND"
  | "WALK_FORWARD_WINDOWS_EMPTY"
  | "SEALED_DATASET_NOT_FOUND"
  | "SEALED_DATASET_DIGEST_MISMATCH"
  | "REGIME_COVERAGE_NOT_FAILED"
  | "INSUFFICIENT_MARKET_BARS"
  | "ARTIFACT_DIGEST_MISMATCH"
  | "EVOLUTION_REJECTION_DIGEST_MISMATCH"
  | "VAULT_PARSE_ERROR"
  | "VAULT_ARTIFACT_MISSING";

export class ResearchFailureReconstructionError extends Error {
  readonly code: ResearchFailureReconstructionErrorCode;

  constructor(code: ResearchFailureReconstructionErrorCode, message?: string) {
    super(message ?? `[research] failure reconstruction: ${code}`);
    this.name = "ResearchFailureReconstructionError";
    this.code = code;
  }
}

export class MarketReasoningGuardrailError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? `[research] market reasoning guardrail: ${code}`);
    this.name = "MarketReasoningGuardrailError";
    this.code = code;
  }
}

export class MarketReasoningAssistError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? `[research] market reasoning assist: ${code}`);
    this.name = "MarketReasoningAssistError";
    this.code = code;
  }
}
