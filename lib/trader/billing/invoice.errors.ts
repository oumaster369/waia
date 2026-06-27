export class DraftInvoiceError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "DraftInvoiceError";
    this.code = code;
  }
}

export class DraftInvoiceValidationError extends DraftInvoiceError {
  constructor(code: string, message?: string) {
    super(code, message);
    this.name = "DraftInvoiceValidationError";
  }
}

export class DraftInvoiceDigestMismatchError extends DraftInvoiceValidationError {
  constructor(message = "INVOICE_RECORD_DIGEST_MISMATCH") {
    super("INVOICE_RECORD_DIGEST_MISMATCH", message);
    this.name = "DraftInvoiceDigestMismatchError";
  }
}

export class DraftInvoiceNotBillableError extends DraftInvoiceValidationError {
  constructor(periodId: string, performanceFee: string) {
    super(
      "DRAFT_INVOICE_NOT_BILLABLE",
      `Reporting period ${periodId} is not billable (performance fee ${performanceFee} below threshold)`,
    );
    this.name = "DraftInvoiceNotBillableError";
  }
}

export class DraftInvoiceContentMismatchError extends DraftInvoiceValidationError {
  constructor(reportingPeriodId: string) {
    super(
      "DRAFT_INVOICE_CONTENT_MISMATCH",
      `Draft invoice content mismatch for reporting period ${reportingPeriodId}`,
    );
    this.name = "DraftInvoiceContentMismatchError";
  }
}

export class DraftInvoiceNotDraftError extends DraftInvoiceValidationError {
  constructor(invoiceId: string, status: string) {
    super(
      "DRAFT_INVOICE_NOT_DRAFT",
      `Invoice ${invoiceId} is not in DRAFT status (current: ${status})`,
    );
    this.name = "DraftInvoiceNotDraftError";
  }
}

export class DraftInvoicePeriodDisclosureMissingError extends DraftInvoiceValidationError {
  constructor(periodId: string, field: string) {
    super(
      "DRAFT_INVOICE_PERIOD_DISCLOSURE_MISSING",
      `Reporting period ${periodId} is missing required disclosure field ${field}`,
    );
    this.name = "DraftInvoicePeriodDisclosureMissingError";
  }
}
