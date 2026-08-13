import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import { requireBigint } from "@/lib/waia-core/treasury/money";

const INTEGER_STRING = /^-?\d+$/;

/** Parse HTTP monetary/atomic authority. JSON numbers are rejected. */
export function parseDecimalBigint(raw: unknown, label: string): bigint {
  if (typeof raw === "number") {
    throw new TreasuryValidationError(
      "JSON_NUMBER_NOT_AUTHORITY",
      `${label} must be a canonical decimal string, not a JSON number`,
    );
  }
  if (typeof raw !== "string") {
    throw new TreasuryValidationError(
      "DECIMAL_STRING_REQUIRED",
      `${label} must be a canonical decimal string`,
    );
  }
  if (raw.trim() !== raw || raw.length === 0) {
    throw new TreasuryValidationError(
      "DECIMAL_STRING_MALFORMED",
      `${label} must not include surrounding whitespace`,
    );
  }
  if (/[eE.]/.test(raw) || !INTEGER_STRING.test(raw)) {
    throw new TreasuryValidationError(
      "DECIMAL_STRING_MALFORMED",
      `${label} must be a base-10 integer string`,
    );
  }
  return BigInt(raw);
}

export function parseNonNegativeDecimalBigint(raw: unknown, label: string): bigint {
  const value = parseDecimalBigint(raw, label);
  if (value < 0n) {
    throw new TreasuryValidationError("AMOUNT_NEGATIVE", `${label} must be >= 0`);
  }
  return value;
}

export function parsePositiveDecimalBigint(raw: unknown, label: string): bigint {
  const value = parseDecimalBigint(raw, label);
  if (value <= 0n) {
    throw new TreasuryValidationError("AMOUNT_NOT_POSITIVE", `${label} must be > 0`);
  }
  return value;
}

export function serializeDecimalBigint(value: bigint | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return requireBigint(value, "value").toString(10);
}
