export const MASTER_KEY_ERROR_CODES = {
  NOT_READY: "MASTER_KEY_NOT_READY",
  VERSION_MISMATCH: "MASTER_KEY_VERSION_MISMATCH",
  INVALID_DEK: "MASTER_KEY_INVALID_DEK",
  DECRYPT_FAILED: "MASTER_KEY_DECRYPT_FAILED",
  CONFIG: "MASTER_KEY_CONFIG_ERROR",
} as const;

export type MasterKeyErrorCode =
  (typeof MASTER_KEY_ERROR_CODES)[keyof typeof MASTER_KEY_ERROR_CODES];

export class MasterKeyError extends Error {
  readonly code: MasterKeyErrorCode;

  constructor(code: MasterKeyErrorCode, message: string) {
    super(message);
    this.name = "MasterKeyError";
    this.code = code;
  }
}

export class MasterKeyNotReadyError extends MasterKeyError {
  constructor(message = "Master key provider is not production-ready.") {
    super(MASTER_KEY_ERROR_CODES.NOT_READY, message);
    this.name = "MasterKeyNotReadyError";
  }
}

export class MasterKeyVersionMismatchError extends MasterKeyError {
  constructor(message = "Unsupported master key version.") {
    super(MASTER_KEY_ERROR_CODES.VERSION_MISMATCH, message);
    this.name = "MasterKeyVersionMismatchError";
  }
}

export class MasterKeyInvalidDekError extends MasterKeyError {
  constructor(message = "Data encryption key must be exactly 32 bytes.") {
    super(MASTER_KEY_ERROR_CODES.INVALID_DEK, message);
    this.name = "MasterKeyInvalidDekError";
  }
}

export class MasterKeyDecryptError extends MasterKeyError {
  constructor(message = "Failed to decrypt wrapped data key.") {
    super(MASTER_KEY_ERROR_CODES.DECRYPT_FAILED, message);
    this.name = "MasterKeyDecryptError";
  }
}

export class MasterKeyConfigError extends MasterKeyError {
  constructor(message: string) {
    super(MASTER_KEY_ERROR_CODES.CONFIG, message);
    this.name = "MasterKeyConfigError";
  }
}
