/** 1 USD = 1_000_000 micros. Display only — never accounting authority. */
export const USD_MICROS_PER_UNIT = 1_000_000n;
const MICROS_PER_CENT = 10_000n;

const INTEGER_STRING = /^-?\d+$/;

export function parseCanonicalIntegerString(raw: string): bigint {
  if (raw.trim() !== raw || raw.length === 0 || !INTEGER_STRING.test(raw)) {
    throw new Error("Canonical money string must be a base-10 integer");
  }
  return BigInt(raw);
}

export function parseOptionalMoneyString(raw: string | null | undefined): bigint | null {
  if (raw === null || raw === undefined || raw === "") return null;
  return parseCanonicalIntegerString(raw);
}

/**
 * Format a canonical micros integer string as USD text using BigInt only.
 * Negative values stay negative. Null/empty is not formatted here.
 */
export function formatUsdFromMicros(raw: string): string {
  const micros = parseCanonicalIntegerString(raw);
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const units = abs / USD_MICROS_PER_UNIT;
  const remainder = abs % USD_MICROS_PER_UNIT;
  const cents = remainder / MICROS_PER_CENT;
  const subCents = remainder % MICROS_PER_CENT;
  const centsStr = cents.toString().padStart(2, "0");
  let fraction = centsStr;
  if (subCents !== 0n) {
    fraction += subCents.toString().padStart(4, "0").replace(/0+$/, "");
  }
  return `${negative ? "-" : ""}$${units.toString()}.${fraction}`;
}

export function formatOptionalUsdFromMicros(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  return formatUsdFromMicros(raw);
}
