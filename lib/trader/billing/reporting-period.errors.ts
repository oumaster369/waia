export class ReportingPeriodError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "ReportingPeriodError";
    this.code = code;
  }
}

export class ReportingPeriodValidationError extends ReportingPeriodError {
  constructor(code: string, message?: string) {
    super(code, message);
    this.name = "ReportingPeriodValidationError";
  }
}

export class ReportingPeriodDigestMismatchError extends ReportingPeriodValidationError {
  constructor(message = "REPORTING_PERIOD_RECORD_DIGEST_MISMATCH") {
    super("REPORTING_PERIOD_RECORD_DIGEST_MISMATCH", message);
    this.name = "ReportingPeriodDigestMismatchError";
  }
}
