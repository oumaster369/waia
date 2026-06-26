export class ReconciliationDigestMismatchError extends Error {
  constructor() {
    super("Reconciliation event digest mismatch");
    this.name = "ReconciliationDigestMismatchError";
  }
}

export class ReconciliationCaseAlreadyExistsError extends Error {
  constructor(settlementId: string) {
    super(`Reconciliation case already exists for settlement ${settlementId}`);
    this.name = "ReconciliationCaseAlreadyExistsError";
  }
}

export class ReconciliationInvalidSettlementOutcomeError extends Error {
  constructor(outcome: string) {
    super(`Cannot open reconciliation case for settlement outcome ${outcome}`);
    this.name = "ReconciliationInvalidSettlementOutcomeError";
  }
}

export class ReconciliationCaseNotFoundError extends Error {
  constructor(caseId: string) {
    super(`Reconciliation case not found: ${caseId}`);
    this.name = "ReconciliationCaseNotFoundError";
  }
}

export class ReconciliationIllegalTransitionError extends Error {
  constructor(caseId: string, currentStatus: string, command: string) {
    super(
      `Illegal reconciliation transition for case ${caseId}: status=${currentStatus} command=${command}`,
    );
    this.name = "ReconciliationIllegalTransitionError";
  }
}

export class ReconciliationStaleConcurrencyTokenError extends Error {
  constructor(caseId: string, expected: number, actual: number) {
    super(`Stale concurrency token for case ${caseId}: expected seq ${expected}, actual ${actual}`);
    this.name = "ReconciliationStaleConcurrencyTokenError";
  }
}

export class ReconciliationCoolingOffNotElapsedError extends Error {
  constructor(caseId: string, coolingOffUntil: Date) {
    super(`Cooling-off not elapsed for case ${caseId} (until ${coolingOffUntil.toISOString()})`);
    this.name = "ReconciliationCoolingOffNotElapsedError";
  }
}

export class ReconciliationProposalNotLiveError extends Error {
  constructor(caseId: string, decisionId: string) {
    super(`Proposal not live for case ${caseId} decision ${decisionId}`);
    this.name = "ReconciliationProposalNotLiveError";
  }
}

export class ReconciliationInvoiceNotEligibleError extends Error {
  constructor(invoiceId: string, reason: string) {
    super(`Invoice ${invoiceId} not eligible: ${reason}`);
    this.name = "ReconciliationInvoiceNotEligibleError";
  }
}

export class ReconciliationApplicationAlreadyExistsError extends Error {
  constructor(settlementId: string) {
    super(`Settlement application already exists for settlement ${settlementId}`);
    this.name = "ReconciliationApplicationAlreadyExistsError";
  }
}

export class ReconciliationNotLeaseHolderError extends Error {
  constructor(caseId: string, operatorId: string) {
    super(`Operator ${operatorId} is not lease holder for case ${caseId}`);
    this.name = "ReconciliationNotLeaseHolderError";
  }
}

export class ReconciliationDuplicateCommandError extends Error {
  constructor(idempotencyKey: string) {
    super(`Duplicate reconciliation command: ${idempotencyKey}`);
    this.name = "ReconciliationDuplicateCommandError";
  }
}

export class ReconciliationMissingRationaleError extends Error {
  constructor(field: string) {
    super(`Missing required rationale: ${field}`);
    this.name = "ReconciliationMissingRationaleError";
  }
}

export class ReconciliationTerminalCaseError extends Error {
  constructor(caseId: string) {
    super(`Reconciliation case ${caseId} is terminal`);
    this.name = "ReconciliationTerminalCaseError";
  }
}
