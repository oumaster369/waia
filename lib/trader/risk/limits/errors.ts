export class RiskLimitsValidationError extends Error {
  readonly code = "RISK_LIMITS_VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "RiskLimitsValidationError";
  }
}
