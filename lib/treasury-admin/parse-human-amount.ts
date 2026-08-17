export type HumanAmountErrorCode =
  | "EMPTY"
  | "NEGATIVE"
  | "ZERO"
  | "EXPONENT"
  | "MALFORMED"
  | "PRECISION"
  | "INFINITY";

export type ParseHumanAmountSuccess = { ok: true; atomic: string };
export type ParseHumanAmountFailure = { ok: false; code: HumanAmountErrorCode; message: string };
export type ParseHumanAmountResult = ParseHumanAmountSuccess | ParseHumanAmountFailure;

const STRICT_DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

function fail(code: HumanAmountErrorCode, message: string): ParseHumanAmountFailure {
  return { ok: false, code, message };
}

/**
 * Convert a Human decimal amount string into a canonical atomic integer string.
 * String/BigInt only — never Number, parseFloat, or floating-point scaling.
 */
export function parseHumanDecimalToAtomic(
  raw: string,
  decimals: number,
  options?: { requirePositive?: boolean },
): ParseHumanAmountResult {
  if (typeof decimals !== "number" || decimals < 0 || decimals % 1 !== 0) {
    return fail("MALFORMED", "Asset decimals are not a non-negative integer.");
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return fail("EMPTY", "Enter an amount.");
  }

  const lowered = trimmed.toLowerCase();
  if (
    lowered === "nan" ||
    lowered === "infinity" ||
    lowered === "+infinity" ||
    lowered === "-infinity"
  ) {
    return fail("INFINITY", "Amount is not a finite decimal.");
  }
  if (/[eE]/.test(trimmed)) {
    return fail(
      "EXPONENT",
      "Exponent notation is not allowed. Enter a plain decimal such as 125.50.",
    );
  }
  if (/[,\s]/.test(trimmed)) {
    return fail("MALFORMED", "Amount cannot include commas, spaces, or grouping separators.");
  }

  const match = STRICT_DECIMAL.exec(trimmed);
  if (!match) {
    return fail("MALFORMED", "Amount must be a plain decimal such as 125.50.");
  }

  const negative = match[1] === "-";
  if (negative) {
    return fail("NEGATIVE", "Amount must be greater than zero.");
  }

  const wholeDigits = match[2] ?? "";
  const fractionDigits = match[3] ?? "";
  if (wholeDigits.length === 0) {
    return fail("MALFORMED", "Amount must be a plain decimal such as 125.50.");
  }
  if (fractionDigits.length > decimals) {
    return fail(
      "PRECISION",
      `This asset accepts at most ${String(decimals)} decimal places. Extra precision is not rounded.`,
    );
  }

  const paddedFraction = fractionDigits.padEnd(decimals, "0");
  const concatenated = `${wholeDigits}${paddedFraction}`.replace(/^0+(?=\d)/, "") || "0";
  const atomic = BigInt(concatenated);
  if (options?.requirePositive !== false && atomic <= 0n) {
    return fail("ZERO", "Amount must be greater than zero.");
  }

  return { ok: true, atomic: atomic.toString(10) };
}

export function humanAmountErrorMessage(result: ParseHumanAmountFailure): string {
  return result.message;
}

/** Display-only reverse of parseHumanDecimalToAtomic. BigInt exact; not accounting authority. */
export function formatAtomicToHumanDecimal(atomic: string, decimals: number): string {
  if (
    !/^-?\d+$/.test(atomic) ||
    typeof decimals !== "number" ||
    decimals < 0 ||
    decimals % 1 !== 0
  ) {
    return atomic;
  }
  const value = BigInt(atomic);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  if (decimals === 0) {
    return `${negative ? "-" : ""}${abs.toString(10)}`;
  }
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const fraction = abs % scale;
  if (fraction === 0n) {
    return `${negative ? "-" : ""}${whole.toString(10)}`;
  }
  const fractionText = fraction.toString(10).padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString(10)}.${fractionText}`;
}
