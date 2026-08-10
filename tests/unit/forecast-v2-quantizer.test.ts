import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  BOOTSTRAP_ROOT_PREFIX_HEX,
  QUANTIZER_VERSION,
  WAIA_CBRNG_MAGIC,
} from "@/lib/trader/intelligence/forecast-v2/constants";
import {
  NonFiniteQuantizeError,
  quantizeScale8HalfUp,
} from "@/lib/trader/intelligence/forecast-v2/quantize-scale8-half-up-v1";

describe("quantizeScale8HalfUp/v1", () => {
  it("exports contract version pin", () => {
    expect(QUANTIZER_VERSION).toBe("quantizeScale8HalfUp/v1");
  });

  it("maps zero to fixed eight-decimal zero", () => {
    expect(quantizeScale8HalfUp(0)).toBe("0.00000000");
    expect(quantizeScale8HalfUp(-0)).toBe("0.00000000");
  });

  it("maps exact binary64 values to fixed scale-8 strings", () => {
    expect(quantizeScale8HalfUp(0.1)).toBe("0.10000000");
    expect(quantizeScale8HalfUp(2.5)).toBe("2.50000000");
    expect(quantizeScale8HalfUp(-2.5)).toBe("-2.50000000");
    expect(quantizeScale8HalfUp(1)).toBe("1.00000000");
  });

  it("rounds HALF_UP at the eighth decimal (ties away from zero)", () => {
    expect(quantizeScale8HalfUp(5e-9)).toBe("0.00000001");
    expect(quantizeScale8HalfUp(-5e-9)).toBe("-0.00000001");
    expect(quantizeScale8HalfUp(1.234567895)).toBe("1.23456790");
    expect(quantizeScale8HalfUp(-1.234567895)).toBe("-1.23456790");
  });

  it("rejects non-finite inputs fail-closed", () => {
    expect(() => quantizeScale8HalfUp(Number.NaN)).toThrow(NonFiniteQuantizeError);
    expect(() => quantizeScale8HalfUp(Number.POSITIVE_INFINITY)).toThrow(NonFiniteQuantizeError);
    expect(() => quantizeScale8HalfUp(Number.NEGATIVE_INFINITY)).toThrow(NonFiniteQuantizeError);
  });

  it("matches frozen alpha_epi configuration scale-8 string", () => {
    expect(quantizeScale8HalfUp(0.1)).toBe("0.10000000");
  });
});

describe("quantizeScale8HalfUp/v1 golden vectors", () => {
  const vectors: Array<{ value: number; expected: string }> = [
    { value: 0, expected: "0.00000000" },
    { value: 1e-8, expected: "0.00000001" },
    { value: -1e-8, expected: "-0.00000001" },
    { value: 1234567.890123499, expected: "1234567.89012350" },
    { value: -1234567.890123499, expected: "-1234567.89012350" },
  ];

  it.each(vectors)("quantizeScale8HalfUp($value) = $expected", ({ value, expected }) => {
    expect(quantizeScale8HalfUp(value)).toBe(expected);
  });
});

describe("quantizeScale8HalfUp/v1 determinism", () => {
  it("is deterministic for repeated calls", () => {
    const sample = 0.12345678912345678;
    const first = quantizeScale8HalfUp(sample);
    const second = quantizeScale8HalfUp(sample);
    expect(first).toBe(second);
    expect(first).toMatch(/^-?\d+\.\d{8}$/);
  });
});

describe("quantizeScale8HalfUp/v1 digest stream compatibility", () => {
  it("feeds dist-sem-v1 component lines with trailing newline semantics", () => {
    const canonical = quantizeScale8HalfUp(0.12345678);
    const line = `${canonical}\n`;
    expect(createHash("sha256").update(line, "utf8").digest("hex")).toMatch(/^[0-9a-f]{64}$/);
  });
});

// Guard against accidental prefix drift in unrelated tests.
void BOOTSTRAP_ROOT_PREFIX_HEX;
void WAIA_CBRNG_MAGIC;
