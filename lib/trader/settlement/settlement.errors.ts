export class SettlementAlreadyExistsError extends Error {
  readonly code = "SETTLEMENT_ALREADY_EXISTS";

  constructor(paymentId: string) {
    super(`[trader/settlement] settlement already exists for payment ${paymentId}`);
    this.name = "SettlementAlreadyExistsError";
  }
}

export class SettlementInvoiceNotFoundError extends Error {
  readonly code = "SETTLEMENT_INVOICE_NOT_FOUND";

  constructor(invoiceId: string) {
    super(`[trader/settlement] invoice not found: ${invoiceId}`);
    this.name = "SettlementInvoiceNotFoundError";
  }
}

export class SettlementDigestMismatchError extends Error {
  readonly code = "SETTLEMENT_DIGEST_MISMATCH";

  constructor() {
    super("[trader/settlement] settlement record digest mismatch");
    this.name = "SettlementDigestMismatchError";
  }
}

export class AccountStatusDigestMismatchError extends Error {
  readonly code = "ACCOUNT_STATUS_DIGEST_MISMATCH";

  constructor() {
    super("[trader/settlement] account status event digest mismatch");
    this.name = "AccountStatusDigestMismatchError";
  }
}

export class SettlementApplicationDigestMismatchError extends Error {
  readonly code = "SETTLEMENT_APPLICATION_DIGEST_MISMATCH";

  constructor() {
    super("[trader/settlement] settlement application digest mismatch");
    this.name = "SettlementApplicationDigestMismatchError";
  }
}

export class IllegalAccountStatusTransitionError extends Error {
  readonly code = "ILLEGAL_ACCOUNT_STATUS_TRANSITION";

  constructor(from: string, eventType: string) {
    super(`[trader/settlement] illegal account status transition ${from} via ${eventType}`);
    this.name = "IllegalAccountStatusTransitionError";
  }
}
