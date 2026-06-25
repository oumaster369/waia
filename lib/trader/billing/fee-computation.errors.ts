export class FeeComputationError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "FeeComputationError";
    this.code = code;
  }
}

export class FeeComputationValidationError extends FeeComputationError {
  constructor(code: string, message?: string) {
    super(code, message);
    this.name = "FeeComputationValidationError";
  }
}

export class FeeComputationPeriodNotClosedError extends FeeComputationValidationError {
  constructor(periodId: string, status: string) {
    super(
      "FEE_COMPUTATION_PERIOD_NOT_CLOSED",
      `Fee computation requires a CLOSED reporting period; period ${periodId} is ${status}`,
    );
    this.name = "FeeComputationPeriodNotClosedError";
  }
}

export class FeeComputationRealizedPnlMissingError extends FeeComputationValidationError {
  constructor(periodId: string) {
    super(
      "FEE_COMPUTATION_REALIZED_PNL_MISSING",
      `Fee computation requires realized_pnl on CLOSED period ${periodId}`,
    );
    this.name = "FeeComputationRealizedPnlMissingError";
  }
}

export class FeeComputationHwmNotBootstrappedError extends FeeComputationValidationError {
  constructor(exchangeAccountId: string) {
    super(
      "FEE_COMPUTATION_HWM_NOT_BOOTSTRAPPED",
      `HWM ledger not bootstrapped for exchange account ${exchangeAccountId}`,
    );
    this.name = "FeeComputationHwmNotBootstrappedError";
  }
}

export class FeeComputationPeriodNotFoundError extends FeeComputationValidationError {
  constructor(periodId: string) {
    super("FEE_COMPUTATION_PERIOD_NOT_FOUND", `Reporting period ${periodId} not found`);
    this.name = "FeeComputationPeriodNotFoundError";
  }
}

export class FeeComputationPriorPeriodRealizedPnlMissingError extends FeeComputationValidationError {
  constructor(periodId: string) {
    super(
      "FEE_COMPUTATION_PRIOR_PERIOD_REALIZED_PNL_MISSING",
      `Closed reporting period ${periodId} has null realized_pnl; cumulative RSP fold cannot proceed`,
    );
    this.name = "FeeComputationPriorPeriodRealizedPnlMissingError";
  }
}
