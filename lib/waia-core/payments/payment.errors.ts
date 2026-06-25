export class IllegalPaymentTransitionError extends Error {
  readonly code = "ILLEGAL_PAYMENT_TRANSITION" as const;

  constructor(
    public readonly paymentId: string,
    public readonly fromStatus: string | null,
    public readonly eventType: string,
  ) {
    super(
      `[waia-core] illegal payment transition for ${paymentId}: ${fromStatus ?? "none"} -> ${eventType}`,
    );
    this.name = "IllegalPaymentTransitionError";
  }
}

export class PaymentConcurrentConflictError extends Error {
  readonly code = "PAYMENT_CONCURRENT_CONFLICT" as const;

  constructor(public readonly paymentId: string) {
    super(`[waia-core] concurrent payment conflict for ${paymentId}`);
    this.name = "PaymentConcurrentConflictError";
  }
}

export class PaymentDigestMismatchError extends Error {
  readonly code = "PAYMENT_DIGEST_MISMATCH" as const;

  constructor(public readonly eventId: string) {
    super(`[waia-core] payment event digest mismatch for ${eventId}`);
    this.name = "PaymentDigestMismatchError";
  }
}

export class PaymentChainBrokenError extends Error {
  readonly code = "PAYMENT_CHAIN_BROKEN" as const;

  constructor(
    public readonly paymentId: string,
    public readonly seq: number,
  ) {
    super(`[waia-core] payment event hash chain broken at ${paymentId} seq ${seq}`);
    this.name = "PaymentChainBrokenError";
  }
}

export class PaymentNotFoundError extends Error {
  readonly code = "PAYMENT_NOT_FOUND" as const;

  constructor(public readonly paymentId: string) {
    super(`[waia-core] payment not found: ${paymentId}`);
    this.name = "PaymentNotFoundError";
  }
}

export class PaymentAttributionRequiredError extends Error {
  readonly code = "PAYMENT_ATTRIBUTION_REQUIRED" as const;

  constructor(public readonly paymentId: string) {
    super(
      `[waia-core] payment confirmation requires subject_invoice_id or payment_address_id for ${paymentId}`,
    );
    this.name = "PaymentAttributionRequiredError";
  }
}

export class PaymentSettlementAlreadyAttributedError extends Error {
  readonly code = "PAYMENT_SETTLEMENT_ALREADY_ATTRIBUTED" as const;

  constructor(
    public readonly settlementNetwork: string,
    public readonly settlementTxHash: string,
    public readonly transferIndex: number,
  ) {
    super(
      `[waia-core] settlement already attributed: ${settlementNetwork}/${settlementTxHash}#${transferIndex}`,
    );
    this.name = "PaymentSettlementAlreadyAttributedError";
  }
}

export class PaymentIdempotencyConflictError extends Error {
  readonly code = "PAYMENT_IDEMPOTENCY_CONFLICT" as const;

  constructor(public readonly idempotencyKey: string) {
    super(`[waia-core] idempotency key already used: ${idempotencyKey}`);
    this.name = "PaymentIdempotencyConflictError";
  }
}
