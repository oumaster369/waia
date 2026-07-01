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
