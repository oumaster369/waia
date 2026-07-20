export class BillingGovernanceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BillingGovernanceError";
    this.code = code;
  }
}

export class InvoiceDisputeInvoiceNotFoundError extends BillingGovernanceError {
  constructor(invoiceId: string) {
    super("INVOICE_DISPUTE_INVOICE_NOT_FOUND", `[trader/billing] invoice not found: ${invoiceId}`);
    this.name = "InvoiceDisputeInvoiceNotFoundError";
  }
}

export class InvoiceDisputeInvalidInvoiceStatusError extends BillingGovernanceError {
  constructor(invoiceId: string, status: string) {
    super(
      "INVOICE_DISPUTE_INVALID_INVOICE_STATUS",
      `[trader/billing] invoice ${invoiceId} cannot be disputed in status ${status}`,
    );
    this.name = "InvoiceDisputeInvalidInvoiceStatusError";
  }
}

export class InvoiceDisputeAlreadyOpenError extends BillingGovernanceError {
  constructor(invoiceId: string) {
    super(
      "INVOICE_DISPUTE_ALREADY_OPEN",
      `[trader/billing] open dispute already exists for invoice ${invoiceId}`,
    );
    this.name = "InvoiceDisputeAlreadyOpenError";
  }
}

export class InvoiceDisputeNotFoundError extends BillingGovernanceError {
  constructor(disputeId: string) {
    super("INVOICE_DISPUTE_NOT_FOUND", `[trader/billing] dispute not found: ${disputeId}`);
    this.name = "InvoiceDisputeNotFoundError";
  }
}

export class InvoiceDisputeNotOpenError extends BillingGovernanceError {
  constructor(disputeId: string, status: string) {
    super(
      "INVOICE_DISPUTE_NOT_OPEN",
      `[trader/billing] dispute ${disputeId} is not open (status=${status})`,
    );
    this.name = "InvoiceDisputeNotOpenError";
  }
}

export class InvoiceCorrectionReasonRequiredError extends BillingGovernanceError {
  constructor() {
    super("INVOICE_CORRECTION_REASON_REQUIRED", "[trader/billing] correction reason is required");
    this.name = "InvoiceCorrectionReasonRequiredError";
  }
}

export class InvoiceCorrectionDigestMismatchError extends BillingGovernanceError {
  constructor() {
    super(
      "INVOICE_CORRECTION_DIGEST_MISMATCH",
      "[trader/billing] invoice correction digest mismatch",
    );
    this.name = "InvoiceCorrectionDigestMismatchError";
  }
}

export class InvoiceDisputeEventDigestMismatchError extends BillingGovernanceError {
  constructor() {
    super(
      "INVOICE_DISPUTE_EVENT_DIGEST_MISMATCH",
      "[trader/billing] invoice dispute event digest mismatch",
    );
    this.name = "InvoiceDisputeEventDigestMismatchError";
  }
}

export class InvoiceDisputeOpenRequiredForCorrectionError extends BillingGovernanceError {
  constructor(invoiceId: string) {
    super(
      "INVOICE_DISPUTE_OPEN_REQUIRED_FOR_CORRECTION",
      `[trader/billing] open dispute required before correction for invoice ${invoiceId}`,
    );
    this.name = "InvoiceDisputeOpenRequiredForCorrectionError";
  }
}

export class IllegalInvoiceDisputeTransitionError extends BillingGovernanceError {
  constructor(from: string, eventType: string) {
    super(
      "ILLEGAL_INVOICE_DISPUTE_TRANSITION",
      `[trader/billing] illegal invoice dispute transition ${from} via ${eventType}`,
    );
    this.name = "IllegalInvoiceDisputeTransitionError";
  }
}
