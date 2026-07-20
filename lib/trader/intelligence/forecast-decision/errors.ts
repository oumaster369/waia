export class ForecastDecisionIdempotencyConflictError extends Error {
  readonly code = "HTR_WP14_IDEMPOTENCY_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "ForecastDecisionIdempotencyConflictError";
  }
}

export class HtrWp14DecisionChainIncompleteError extends Error {
  readonly code = "HTR_WP14_DECISION_CHAIN_INCOMPLETE" as const;

  constructor(message: string) {
    super(message);
    this.name = "HtrWp14DecisionChainIncompleteError";
  }
}
