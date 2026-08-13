import { assertScale8Canonical } from "./scientific-identity-validators-v1";

const INT64_MIN = -9223372036854775808n;
const INT64_MAX = 9223372036854775807n;

/**
 * Exact scale-8 decimal string ↔ int8 scaled integer (value * 10^8).
 * No rounding; canonical presentation recreates the exact 8-decimal string.
 */
export function scale8TextToInt8(value: string): bigint {
  assertScale8Canonical(value, "scale8");
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  const [whole, frac] = body.split(".");
  if (frac === undefined || frac.length !== 8) {
    throw new Error(`[scale8-storage] expected exactly 8 fractional digits: ${value}`);
  }
  const scaled = BigInt(whole || "0") * 100000000n + BigInt(frac);
  const signed = negative ? -scaled : scaled;
  if (signed < INT64_MIN || signed > INT64_MAX) {
    throw new Error(`[scale8-storage] scaled value outside int64: ${value}`);
  }
  return signed;
}

export function scale8Int8ToText(value: bigint | number | string): string {
  const n = typeof value === "bigint" ? value : BigInt(value);
  if (n < INT64_MIN || n > INT64_MAX) {
    throw new Error(`[scale8-storage] int64 out of range: ${n.toString()}`);
  }
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const whole = abs / 100000000n;
  const frac = (abs % 100000000n).toString().padStart(8, "0");
  const text = `${negative ? "-" : ""}${whole.toString()}.${frac}`;
  assertScale8Canonical(text, "scale8Int8ToText");
  return text;
}
