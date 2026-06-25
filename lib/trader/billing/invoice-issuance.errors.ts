export class InvoiceIssuanceError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "InvoiceIssuanceError";
    this.code = code;
  }
}

export class InvoiceIssuanceValidationError extends InvoiceIssuanceError {
  constructor(code: string, message?: string) {
    super(code, message);
    this.name = "InvoiceIssuanceValidationError";
  }
}

export class IssuanceOperatorRequiredError extends InvoiceIssuanceValidationError {
  constructor() {
    super("ISSUANCE_OPERATOR_REQUIRED", "Invoice issuance requires an authenticated operator");
    this.name = "IssuanceOperatorRequiredError";
  }
}

export class IssuanceAttestationIncompleteError extends InvoiceIssuanceValidationError {
  constructor() {
    super(
      "ISSUANCE_ATTESTATION_INCOMPLETE",
      "All ADR-0008 issuance attestation items must be confirmed before approval",
    );
    this.name = "IssuanceAttestationIncompleteError";
  }
}

export class IssuanceApprovalRequiredError extends InvoiceIssuanceValidationError {
  constructor(invoiceId: string) {
    super("ISSUANCE_APPROVAL_REQUIRED", `Invoice ${invoiceId} has no pending issuance approval`);
    this.name = "IssuanceApprovalRequiredError";
  }
}

export class IssuanceCoolingOffNotElapsedError extends InvoiceIssuanceValidationError {
  constructor(invoiceId: string, coolingOffUntil: Date) {
    super(
      "ISSUANCE_COOLING_OFF_NOT_ELAPSED",
      `Invoice ${invoiceId} cooling-off period has not elapsed (until ${coolingOffUntil.toISOString()})`,
    );
    this.name = "IssuanceCoolingOffNotElapsedError";
  }
}

export class IssuanceApprovalExpiredError extends InvoiceIssuanceValidationError {
  constructor(invoiceId: string, expiredAt: Date) {
    super(
      "ISSUANCE_APPROVAL_EXPIRED",
      `Invoice ${invoiceId} issuance approval expired at ${expiredAt.toISOString()}`,
    );
    this.name = "IssuanceApprovalExpiredError";
  }
}

export class IssuanceAlreadyIssuedError extends InvoiceIssuanceValidationError {
  constructor(invoiceId: string) {
    super("ISSUANCE_ALREADY_ISSUED", `Invoice ${invoiceId} is already issued`);
    this.name = "IssuanceAlreadyIssuedError";
  }
}

export class IssuanceNotDraftError extends InvoiceIssuanceValidationError {
  constructor(invoiceId: string, status: string) {
    super("ISSUANCE_NOT_DRAFT", `Invoice ${invoiceId} is not in DRAFT status (current: ${status})`);
    this.name = "IssuanceNotDraftError";
  }
}

export class IssuanceHwmInconsistentError extends InvoiceIssuanceValidationError {
  constructor(invoiceId: string, expected: string, actual: string) {
    super(
      "ISSUANCE_HWM_INCONSISTENT",
      `Invoice ${invoiceId} HWM drift: expected previous HWM ${expected}, current ledger ${actual}`,
    );
    this.name = "IssuanceHwmInconsistentError";
  }
}

export class IssuanceConcurrentConflictError extends InvoiceIssuanceValidationError {
  constructor(invoiceId: string) {
    super("ISSUANCE_CONCURRENT_CONFLICT", `Concurrent issuance conflict for invoice ${invoiceId}`);
    this.name = "IssuanceConcurrentConflictError";
  }
}

export class IssuanceInvoiceNotFoundError extends InvoiceIssuanceValidationError {
  constructor(invoiceId: string) {
    super("ISSUANCE_INVOICE_NOT_FOUND", `Invoice ${invoiceId} not found`);
    this.name = "IssuanceInvoiceNotFoundError";
  }
}
