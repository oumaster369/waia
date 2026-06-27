export class StrategyPromotionError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "StrategyPromotionError";
    this.code = code;
  }
}

export class StrategyPromotionValidationError extends StrategyPromotionError {
  constructor(code: string, message?: string) {
    super(code, message);
    this.name = "StrategyPromotionValidationError";
  }
}

export class StrategyPromotionConcurrencyError extends StrategyPromotionError {
  constructor(message = "STRATEGY_PROMOTION_STATE_VERSION_MISMATCH") {
    super("STRATEGY_PROMOTION_STATE_VERSION_MISMATCH", message);
    this.name = "StrategyPromotionConcurrencyError";
  }
}

export class StrategyPromotionNotFoundError extends StrategyPromotionError {
  constructor(message = "STRATEGY_PROMOTION_NOT_FOUND") {
    super("STRATEGY_PROMOTION_NOT_FOUND", message);
    this.name = "StrategyPromotionNotFoundError";
  }
}

export class StrategyPromotionConflictError extends StrategyPromotionError {
  constructor(code: string, message?: string) {
    super(code, message);
    this.name = "StrategyPromotionConflictError";
  }
}

export class StrategyPromotionCoolingOffNotElapsedError extends StrategyPromotionError {
  constructor(message = "STRATEGY_PROMOTION_COOLING_OFF_NOT_ELAPSED") {
    super("STRATEGY_PROMOTION_COOLING_OFF_NOT_ELAPSED", message);
    this.name = "StrategyPromotionCoolingOffNotElapsedError";
  }
}

export class StrategyPromotionRequiredError extends StrategyPromotionError {
  constructor(message = "STRATEGY_PROMOTION_REQUIRED") {
    super("STRATEGY_PROMOTION_REQUIRED", message);
    this.name = "StrategyPromotionRequiredError";
  }
}

export class StrategyPromotionVersionMismatchError extends StrategyPromotionError {
  constructor(message = "STRATEGY_PROMOTION_VERSION_MISMATCH") {
    super("STRATEGY_PROMOTION_VERSION_MISMATCH", message);
    this.name = "StrategyPromotionVersionMismatchError";
  }
}
