export class IntelligenceRecordsIdempotencyConflictError extends Error {
  readonly code = "HTR_WP13_IDEMPOTENCY_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "IntelligenceRecordsIdempotencyConflictError";
  }
}

export class IntelligenceRecordsBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntelligenceRecordsBundleError";
  }
}
