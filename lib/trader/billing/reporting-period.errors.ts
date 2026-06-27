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

export class ReportingPeriodAlreadyOpenError extends ReportingPeriodValidationError {
  constructor(exchangeAccountId: string) {
    super(
      "REPORTING_PERIOD_ALREADY_OPEN",
      `Reporting period already open for exchange account ${exchangeAccountId}`,
    );
    this.name = "ReportingPeriodAlreadyOpenError";
  }
}

export class ReportingPeriodNotOpenError extends ReportingPeriodValidationError {
  constructor(exchangeAccountId: string) {
    super(
      "REPORTING_PERIOD_NOT_OPEN",
      `No open reporting period for exchange account ${exchangeAccountId}`,
    );
    this.name = "ReportingPeriodNotOpenError";
  }
}

export class ReportingPeriodInvalidTransitionError extends ReportingPeriodValidationError {
  constructor(from: string, to: string) {
    super(
      "REPORTING_PERIOD_INVALID_TRANSITION",
      `Cannot transition reporting period from ${from} to ${to}`,
    );
    this.name = "ReportingPeriodInvalidTransitionError";
  }
}
