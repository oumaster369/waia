export const CREDENTIAL_ERROR_CODES = {
  NOT_FOUND: "CREDENTIAL_NOT_FOUND",
  DECRYPT_FAILED: "CREDENTIAL_DECRYPT_FAILED",
  PAYLOAD_INVALID: "CREDENTIAL_PAYLOAD_INVALID",
} as const;

export type CredentialErrorCode =
  (typeof CREDENTIAL_ERROR_CODES)[keyof typeof CREDENTIAL_ERROR_CODES];

export class CredentialError extends Error {
  readonly code: CredentialErrorCode;

  constructor(code: CredentialErrorCode, message: string) {
    super(message);
    this.name = "CredentialError";
    this.code = code;
  }
}

export class CredentialNotFoundError extends CredentialError {
  constructor(message = "Exchange credential not found.") {
    super(CREDENTIAL_ERROR_CODES.NOT_FOUND, message);
    this.name = "CredentialNotFoundError";
  }
}

export class CredentialDecryptError extends CredentialError {
  constructor(message = "Failed to decrypt exchange credential payload.") {
    super(CREDENTIAL_ERROR_CODES.DECRYPT_FAILED, message);
    this.name = "CredentialDecryptError";
  }
}

export class CredentialPayloadInvalidError extends CredentialError {
  constructor(message = "Exchange credential payload is invalid or incomplete.") {
    super(CREDENTIAL_ERROR_CODES.PAYLOAD_INVALID, message);
    this.name = "CredentialPayloadInvalidError";
  }
}
