import { QUANTIZER_VERSION } from "./constants";

export { QUANTIZER_VERSION };

export class NonFiniteQuantizeError extends Error {
  readonly code = "NON_FINITE_QUANTIZE_INPUT";

  constructor(value: number) {
    super(`[forecast-v2/quantizer] non-finite input: ${value}`);
    this.name = "NonFiniteQuantizeError";
  }
}

type Ieee754Parts = {
  sign: -1n | 1n;
  mantissa: bigint;
  exponent: number;
};

function decodeIeee754Binary64(value: number): Ieee754Parts {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  const bits = view.getBigUint64(0, false);

  const sign = bits >> 63n === 1n ? -1n : 1n;
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const fractionBits = bits & ((1n << 52n) - 1n);

  if (exponentBits === 0x7ff) {
    throw new NonFiniteQuantizeError(value);
  }

  if (exponentBits === 0) {
    if (fractionBits === 0n) {
      return { sign, mantissa: 0n, exponent: 0 };
    }
    return { sign, mantissa: fractionBits, exponent: -1074 };
  }

  return {
    sign,
    mantissa: (1n << 52n) | fractionBits,
    exponent: exponentBits - 1023 - 52,
  };
}

function divHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new Error("[forecast-v2/quantizer] division by zero");
  }
  const negative = numerator < 0n !== denominator < 0n;
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;
  let quotient = a / b;
  const remainder = a % b;
  if (2n * remainder >= b) {
    quotient += 1n;
  }
  return negative ? -quotient : quotient;
}

function formatFixedScale8(scaled: bigint): string {
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  const whole = absolute / 100_000_000n;
  const fraction = absolute % 100_000_000n;
  const fractionStr = fraction.toString().padStart(8, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fractionStr}`;
}

/**
 * Forecast-only HALF_UP quantizer (§2.5). Ties round away from zero.
 */
export function quantizeScale8HalfUp(value: number): string {
  if (!Number.isFinite(value)) {
    throw new NonFiniteQuantizeError(value);
  }

  const { sign, mantissa, exponent } = decodeIeee754Binary64(value);
  if (mantissa === 0n) {
    return "0.00000000";
  }

  const numerator = sign * mantissa * 100_000_000n;
  const scaled =
    exponent >= 0 ? numerator << BigInt(exponent) : divHalfUp(numerator, 1n << BigInt(-exponent));

  return formatFixedScale8(scaled);
}
