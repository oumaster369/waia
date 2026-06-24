export class HwmLedgerError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "HwmLedgerError";
    this.code = code;
  }
}

export class HwmLedgerValidationError extends HwmLedgerError {
  constructor(code: string, message?: string) {
    super(code, message);
    this.name = "HwmLedgerValidationError";
  }
}

export class HwmLedgerDigestMismatchError extends HwmLedgerValidationError {
  constructor(message = "HWM_LEDGER_RECORD_DIGEST_MISMATCH") {
    super("HWM_LEDGER_RECORD_DIGEST_MISMATCH", message);
    this.name = "HwmLedgerDigestMismatchError";
  }
}

export class HwmLedgerAlreadyBootstrappedError extends HwmLedgerValidationError {
  constructor(exchangeAccountId: string) {
    super(
      "HWM_LEDGER_ALREADY_BOOTSTRAPPED",
      `HWM ledger already bootstrapped for exchange account ${exchangeAccountId}`,
    );
    this.name = "HwmLedgerAlreadyBootstrappedError";
  }
}

export class HwmLedgerNotBootstrappedError extends HwmLedgerValidationError {
  constructor(exchangeAccountId: string) {
    super(
      "HWM_LEDGER_NOT_BOOTSTRAPPED",
      `HWM ledger not bootstrapped for exchange account ${exchangeAccountId}`,
    );
    this.name = "HwmLedgerNotBootstrappedError";
  }
}

export class HwmLedgerRatchetNotAllowedError extends HwmLedgerValidationError {
  constructor(exchangeAccountId: string, newHwm: string, currentHwm: string) {
    super(
      "HWM_LEDGER_RATCHET_NOT_ALLOWED",
      `HWM ratchet not allowed for exchange account ${exchangeAccountId}: new ${newHwm} must exceed current ${currentHwm}`,
    );
    this.name = "HwmLedgerRatchetNotAllowedError";
  }
}

export class HwmLedgerRollbackReasonRequiredError extends HwmLedgerValidationError {
  constructor() {
    super("HWM_LEDGER_ROLLBACK_REASON_REQUIRED", "HWM rollback requires a non-empty reason");
    this.name = "HwmLedgerRollbackReasonRequiredError";
  }
}
