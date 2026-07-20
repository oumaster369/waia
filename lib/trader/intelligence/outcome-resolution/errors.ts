export class OutcomeResolutionIdempotencyConflictError extends Error {
  readonly code = "HTR_WP21_IDEMPOTENCY_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "OutcomeResolutionIdempotencyConflictError";
  }
}

export class OutcomeResolutionEarlyResolutionError extends Error {
  readonly code = "HTR_WP21_EARLY_RESOLUTION" as const;

  constructor(message: string) {
    super(message);
    this.name = "OutcomeResolutionEarlyResolutionError";
  }
}

export class OutcomeResolutionLookaheadError extends Error {
  readonly code = "HTR_WP21_LOOKAHEAD" as const;

  constructor(message: string) {
    super(message);
    this.name = "OutcomeResolutionLookaheadError";
  }
}
