export class OrgLiveTradingNotPermittedError extends Error {
  readonly code = "ORG_LIVE_TRADING_NOT_PERMITTED" as const;

  constructor(organizationId: string) {
    super(`Org-level live trading is not permitted for organization ${organizationId}`);
    this.name = "OrgLiveTradingNotPermittedError";
  }
}

export class OrgLiveEnableRequiredError extends Error {
  readonly code = "ORG_LIVE_ENABLE_REQUIRED" as const;

  constructor() {
    super("Organization live-enable state must be ENABLED");
    this.name = "OrgLiveEnableRequiredError";
  }
}

export class ExecutionHostUnavailableError extends Error {
  readonly code = "EXECUTION_HOST_UNAVAILABLE" as const;

  constructor() {
    super("Execution host health check failed or host URL is not configured");
    this.name = "ExecutionHostUnavailableError";
  }
}

export class LivePathNotionalCapExceededError extends Error {
  readonly code = "LIVE_PATH_NOTIONAL_CAP_EXCEEDED" as const;

  constructor(notional: string, cap: string) {
    super(`Live order notional ${notional} exceeds cap ${cap}`);
    this.name = "LivePathNotionalCapExceededError";
  }
}

export class LivePathStrategyContextRequiredError extends Error {
  readonly code = "LIVE_PATH_STRATEGY_CONTEXT_REQUIRED" as const;

  constructor() {
    super("strategyId and strategyVersion are required for live execution");
    this.name = "LivePathStrategyContextRequiredError";
  }
}

export class LivePathCredentialRequiredError extends Error {
  readonly code = "LIVE_PATH_CREDENTIAL_REQUIRED" as const;

  constructor() {
    super("credentialId is required for live HTX execution");
    this.name = "LivePathCredentialRequiredError";
  }
}

export class LivePathRiskRejectedError extends Error {
  readonly code = "LIVE_PATH_RISK_REJECTED" as const;

  constructor(outcome: string) {
    super(`Risk engine rejected live order with outcome ${outcome}`);
    this.name = "LivePathRiskRejectedError";
  }
}

export class OrgLiveEnableValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OrgLiveEnableValidationError";
    this.code = code;
  }
}

export class OrgLiveEnableConcurrencyError extends Error {
  readonly code = "ORG_LIVE_ENABLE_STATE_VERSION_MISMATCH" as const;

  constructor() {
    super("Org live-enable state version mismatch");
    this.name = "OrgLiveEnableConcurrencyError";
  }
}

export class OrgLiveEnableConflictError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OrgLiveEnableConflictError";
    this.code = code;
  }
}

export class OrgLiveEnableCoolingOffNotElapsedError extends Error {
  readonly code = "ORG_LIVE_ENABLE_COOLING_OFF_NOT_ELAPSED" as const;

  constructor() {
    super("Org live-enable cooling-off period has not elapsed");
    this.name = "OrgLiveEnableCoolingOffNotElapsedError";
  }
}

export class OrgLiveEnableAckRequiredError extends Error {
  readonly code = "ORG_LIVE_ENABLE_ACK_REQUIRED" as const;

  constructor() {
    super("Operator acknowledgement phrase is required for org live-enable confirmation");
    this.name = "OrgLiveEnableAckRequiredError";
  }
}
