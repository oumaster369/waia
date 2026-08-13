export class IllegalTreasuryTransitionError extends Error {
  readonly code = "ILLEGAL_TREASURY_TRANSITION" as const;

  constructor(
    public readonly entityId: string,
    public readonly fromStatus: string,
    public readonly toStatus: string,
  ) {
    super(`[waia-core] illegal treasury transition for ${entityId}: ${fromStatus} -> ${toStatus}`);
    this.name = "IllegalTreasuryTransitionError";
  }
}

export class TreasuryNotFoundError extends Error {
  readonly code = "TREASURY_NOT_FOUND" as const;

  constructor(
    public readonly entityType: string,
    public readonly entityId: string,
  ) {
    super(`[waia-core] treasury ${entityType} not found: ${entityId}`);
    this.name = "TreasuryNotFoundError";
  }
}

export class TreasuryValidationError extends Error {
  readonly code = "TREASURY_VALIDATION" as const;

  constructor(
    public readonly reasonCode: string,
    message: string,
  ) {
    super(`[waia-core] ${reasonCode}: ${message}`);
    this.name = "TreasuryValidationError";
  }
}

export class TreasuryOrgScopeError extends Error {
  readonly code = "TREASURY_ORG_SCOPE" as const;

  constructor(message = "ORG_CONTEXT_REQUIRED") {
    super(`[waia-core] ${message}`);
    this.name = "TreasuryOrgScopeError";
  }
}
