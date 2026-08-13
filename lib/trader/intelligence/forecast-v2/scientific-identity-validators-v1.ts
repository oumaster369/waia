/** Byte-exact E1 identity field validators (DEE-518 §2.11). */
export const SCIENTIFIC_IDENTITY_VALIDATORS_VERSION = "scientific-identity-validators/v1" as const;

const DIGEST_HEX64 = /^[0-9a-f]{64}$/;
const UUID_RFC4122 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE_RELEASE_SHA = /^[0-9a-f]{40}$/;
const SCALE8_PATTERN = /^-?\d+\.\d{8}$/;

export class ScientificIdentityValidationError extends Error {
  readonly code = "SCIENTIFIC_IDENTITY_VALIDATION_ERROR" as const;

  constructor(field: string, message: string) {
    super(`[forecast-v2/identity/${field}] ${message}`);
    this.name = "ScientificIdentityValidationError";
  }
}

export function assertDigestHex64(value: string, field: string): void {
  if (typeof value !== "string" || !DIGEST_HEX64.test(value)) {
    throw new ScientificIdentityValidationError(
      field,
      "must be exactly 64 lowercase hex characters",
    );
  }
}

export function assertUuidRfc4122(value: string, field: string): void {
  if (typeof value !== "string" || value.length !== 36 || !UUID_RFC4122.test(value)) {
    throw new ScientificIdentityValidationError(
      field,
      "must be RFC4122 lowercase hyphenated UUID (36 chars)",
    );
  }
}

export function assertCodeReleaseSha(value: string, field: string): void {
  if (typeof value !== "string" || !CODE_RELEASE_SHA.test(value)) {
    throw new ScientificIdentityValidationError(
      field,
      "must be exactly 40 lowercase hex characters (Git SHA-1)",
    );
  }
}

export function assertCanonicalIntegerLine(
  value: number,
  field: string,
  options?: { nonnegative?: boolean; allowZero?: boolean },
): string {
  if (!Number.isSafeInteger(value)) {
    throw new ScientificIdentityValidationError(field, "must be a finite safe integer");
  }
  if (options?.nonnegative && value < 0) {
    throw new ScientificIdentityValidationError(field, "must be nonnegative");
  }
  if (options?.allowZero === false && value === 0) {
    throw new ScientificIdentityValidationError(field, "must be positive");
  }
  const line = String(value);
  if (line.startsWith("+")) {
    throw new ScientificIdentityValidationError(field, "must not have leading +");
  }
  if (line.length > 1 && line.startsWith("0")) {
    throw new ScientificIdentityValidationError(
      field,
      "must not have leading zero except literal 0",
    );
  }
  return line;
}

export function assertAsciiLine(value: string, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new ScientificIdentityValidationError(field, "must be non-empty ASCII string");
  }
  if (value.includes("\n") || value.includes("\r")) {
    throw new ScientificIdentityValidationError(field, "must not contain LF or CR");
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      throw new ScientificIdentityValidationError(field, "must be printable ASCII");
    }
  }
}

export function assertScale8Canonical(value: string, field: string): void {
  if (typeof value !== "string" || !SCALE8_PATTERN.test(value)) {
    throw new ScientificIdentityValidationError(field, "must be canonical scale-8 form");
  }
}

export function digestHexFromBuffer(buffer: Buffer, field: string): string {
  if (buffer.length !== 32) {
    throw new ScientificIdentityValidationError(field, "digest buffer must be 32 bytes");
  }
  const hex = buffer.toString("hex");
  assertDigestHex64(hex, field);
  return hex;
}
