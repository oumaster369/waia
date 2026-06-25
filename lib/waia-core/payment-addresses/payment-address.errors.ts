export class IllegalAddressTransitionError extends Error {
  readonly code = "ILLEGAL_ADDRESS_TRANSITION" as const;

  constructor(
    public readonly addressId: string,
    public readonly fromStatus: string | null,
    public readonly eventType: string,
  ) {
    super(
      `[waia-core] illegal address transition for ${addressId}: ${fromStatus ?? "none"} -> ${eventType}`,
    );
    this.name = "IllegalAddressTransitionError";
  }
}

export class AddressNotFoundError extends Error {
  readonly code = "ADDRESS_NOT_FOUND" as const;

  constructor(public readonly addressId: string) {
    super(`[waia-core] address not found: ${addressId}`);
    this.name = "AddressNotFoundError";
  }
}

export class AddressAlreadyExistsError extends Error {
  readonly code = "ADDRESS_ALREADY_EXISTS" as const;

  constructor(
    public readonly network: string,
    public readonly address: string,
  ) {
    super(`[waia-core] address already exists: ${network}/${address}`);
    this.name = "AddressAlreadyExistsError";
  }
}

export class AddressOrgOwnershipMismatchError extends Error {
  readonly code = "ADDRESS_ORG_OWNERSHIP_MISMATCH" as const;

  constructor(
    public readonly addressId: string,
    public readonly expectedOrgId: string,
    public readonly actualOrgId: string,
  ) {
    super(
      `[waia-core] address org ownership mismatch for ${addressId}: expected ${expectedOrgId}, got ${actualOrgId}`,
    );
    this.name = "AddressOrgOwnershipMismatchError";
  }
}

export class AddressAlreadyAssignedError extends Error {
  readonly code = "ADDRESS_ALREADY_ASSIGNED" as const;

  constructor(public readonly addressId: string) {
    super(`[waia-core] address already assigned: ${addressId}`);
    this.name = "AddressAlreadyAssignedError";
  }
}

export class AddressIdempotencyConflictError extends Error {
  readonly code = "ADDRESS_IDEMPOTENCY_CONFLICT" as const;

  constructor(public readonly idempotencyKey: string) {
    super(`[waia-core] address idempotency key already used: ${idempotencyKey}`);
    this.name = "AddressIdempotencyConflictError";
  }
}

export class AddressChainBrokenError extends Error {
  readonly code = "ADDRESS_CHAIN_BROKEN" as const;

  constructor(
    public readonly addressId: string,
    public readonly seq: number,
  ) {
    super(`[waia-core] payment address event hash chain broken at ${addressId} seq ${seq}`);
    this.name = "AddressChainBrokenError";
  }
}

export class AddressDigestMismatchError extends Error {
  readonly code = "ADDRESS_DIGEST_MISMATCH" as const;

  constructor(public readonly eventId: string) {
    super(`[waia-core] payment address event digest mismatch for ${eventId}`);
    this.name = "AddressDigestMismatchError";
  }
}
