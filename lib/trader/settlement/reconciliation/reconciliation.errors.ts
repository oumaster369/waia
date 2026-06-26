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
