/** Fixed decimal scale for spot notional math (8 dp). */
export const DECIMAL_SCALE = 8;
export const DECIMAL_SCALE_FACTOR = 10n ** BigInt(DECIMAL_SCALE);

export class InvalidDecimalError extends Error {
  readonly code = "INVALID_DECIMAL";

  constructor(value: string) {
    super(`[trader/risk] invalid decimal: ${value}`);
    this.name = "InvalidDecimalError";
  }
}

export type ScaledDecimal = bigint;

function trimLeadingZeros(value: string): string {
  return value.replace(/^0+(?=\d)/, "");
}

function normalizeDecimalString(value: string): { sign: bigint; scaled: ScaledDecimal } {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "-" || trimmed === "+") {
    throw new InvalidDecimalError(value);
  }

  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  if (unsigned.startsWith("+")) {
    throw new InvalidDecimalError(value);
  }

  const parts = unsigned.split(".");
  if (parts.length > 2) {
    throw new InvalidDecimalError(value);
  }

  const [wholePartRaw, fractionPartRaw = ""] = parts;
  if (!/^\d*$/.test(wholePartRaw) || !/^\d*$/.test(fractionPartRaw)) {
    throw new InvalidDecimalError(value);
  }

  if (fractionPartRaw.length > DECIMAL_SCALE) {
    throw new InvalidDecimalError(value);
  }

  const wholePart = wholePartRaw === "" ? "0" : trimLeadingZeros(wholePartRaw);
  const fractionPart = fractionPartRaw.padEnd(DECIMAL_SCALE, "0");
  const combined = `${wholePart}${fractionPart}`.replace(/^0+(?=\d)/, "") || "0";
  const scaled = BigInt(combined);
  const sign = negative && scaled !== 0n ? -1n : 1n;
  return { sign, scaled };
}

export function parseDecimal(value: string): ScaledDecimal {
  const { sign, scaled } = normalizeDecimalString(value);
  return sign * scaled;
}

export function formatDecimal(scaled: ScaledDecimal): string {
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  const whole = absolute / DECIMAL_SCALE_FACTOR;
  const fraction = absolute % DECIMAL_SCALE_FACTOR;
  const fractionStr = fraction.toString().padStart(DECIMAL_SCALE, "0").replace(/0+$/, "");
  const body = fractionStr.length > 0 ? `${whole}.${fractionStr}` : whole.toString();
  return negative ? `-${body}` : body;
}

export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function multiplyDecimal(a: string, b: string): string {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  const product = (left * right) / DECIMAL_SCALE_FACTOR;
  return formatDecimal(product);
}

export function divideDecimal(a: string, b: string): string {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  if (right === 0n) {
    throw new InvalidDecimalError(b);
  }
  const quotient = (left * DECIMAL_SCALE_FACTOR) / right;
  return formatDecimal(quotient);
}

export function minDecimal(a: string, b: string): string {
  return compareDecimal(a, b) <= 0
    ? formatDecimal(parseDecimal(a))
    : formatDecimal(parseDecimal(b));
}

export function floorDecimal(value: string): string {
  const scaled = parseDecimal(value);
  return formatDecimal(scaled);
}

export function isPositiveDecimal(value: string): boolean {
  return parseDecimal(value) > 0n;
}

export function isZeroDecimal(value: string): boolean {
  return parseDecimal(value) === 0n;
}

export function addDecimal(a: string, b: string): string {
  return formatDecimal(parseDecimal(a) + parseDecimal(b));
}

export function subtractDecimal(a: string, b: string): string {
  return formatDecimal(parseDecimal(a) - parseDecimal(b));
}
