import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { TREASURY_USDT_V1_DECIMALS } from "@/lib/treasury-admin/canonical";
import {
  formatAtomicToHumanDecimal,
  parseHumanDecimalToAtomic,
} from "@/lib/treasury-admin/parse-human-amount";

describe("parseHumanDecimalToAtomic", () => {
  it("does not use Number, parseFloat, or floating-point scaling in source", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/treasury-admin/parse-human-amount.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\bNumber\(/);
    expect(source).not.toMatch(/\bparseFloat\(/);
    expect(source).not.toMatch(/Math\.round/);
    expect(source).not.toMatch(/Math\.pow/);
  });

  it("uses the canonical USDT V1 decimal count", () => {
    expect(TREASURY_USDT_V1_DECIMALS).toBe(6);
  });

  it("converts exact Human decimals to atomic integer strings", () => {
    expect(parseHumanDecimalToAtomic("1", TREASURY_USDT_V1_DECIMALS)).toEqual({
      ok: true,
      atomic: "1000000",
    });
    expect(parseHumanDecimalToAtomic("125.50", TREASURY_USDT_V1_DECIMALS)).toEqual({
      ok: true,
      atomic: "125500000",
    });
    expect(parseHumanDecimalToAtomic("0.000001", TREASURY_USDT_V1_DECIMALS)).toEqual({
      ok: true,
      atomic: "1",
    });
    expect(parseHumanDecimalToAtomic("1.234567", TREASURY_USDT_V1_DECIMALS)).toEqual({
      ok: true,
      atomic: "1234567",
    });
  });

  it("rejects unsupported precision instead of rounding", () => {
    const result = parseHumanDecimalToAtomic("0.0000001", TREASURY_USDT_V1_DECIMALS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PRECISION");
  });

  it("rejects malformed, empty, exponent, zero, and negative input", () => {
    expect(parseHumanDecimalToAtomic("", TREASURY_USDT_V1_DECIMALS).ok).toBe(false);
    expect(parseHumanDecimalToAtomic("1e6", TREASURY_USDT_V1_DECIMALS).ok).toBe(false);
    expect(parseHumanDecimalToAtomic("1,234.00", TREASURY_USDT_V1_DECIMALS).ok).toBe(false);
    expect(parseHumanDecimalToAtomic("abc", TREASURY_USDT_V1_DECIMALS).ok).toBe(false);
    expect(parseHumanDecimalToAtomic("NaN", TREASURY_USDT_V1_DECIMALS).ok).toBe(false);
    expect(parseHumanDecimalToAtomic("Infinity", TREASURY_USDT_V1_DECIMALS).ok).toBe(false);
    expect(parseHumanDecimalToAtomic("-1", TREASURY_USDT_V1_DECIMALS).ok).toBe(false);
    expect(parseHumanDecimalToAtomic("0", TREASURY_USDT_V1_DECIMALS).ok).toBe(false);
    expect(parseHumanDecimalToAtomic("0.0", TREASURY_USDT_V1_DECIMALS).ok).toBe(false);
    expect(parseHumanDecimalToAtomic(".5", TREASURY_USDT_V1_DECIMALS).ok).toBe(false);
    expect(parseHumanDecimalToAtomic("1.", TREASURY_USDT_V1_DECIMALS).ok).toBe(false);
  });

  it("round-trips exact atomic display with BigInt only", () => {
    expect(formatAtomicToHumanDecimal("1000000", TREASURY_USDT_V1_DECIMALS)).toBe("1");
    expect(formatAtomicToHumanDecimal("125500000", TREASURY_USDT_V1_DECIMALS)).toBe("125.5");
    expect(formatAtomicToHumanDecimal("1", TREASURY_USDT_V1_DECIMALS)).toBe("0.000001");
  });

  it("normalizes leading and trailing zeros without rounding", () => {
    expect(parseHumanDecimalToAtomic("001", TREASURY_USDT_V1_DECIMALS)).toEqual({
      ok: true,
      atomic: "1000000",
    });
    expect(parseHumanDecimalToAtomic("1.50", TREASURY_USDT_V1_DECIMALS)).toEqual({
      ok: true,
      atomic: "1500000",
    });
    expect(parseHumanDecimalToAtomic("1.500000", TREASURY_USDT_V1_DECIMALS)).toEqual({
      ok: true,
      atomic: "1500000",
    });
  });

  it("keeps integers beyond Number.MAX_SAFE_INTEGER exact", () => {
    const human = "9007199254740993";
    expect(parseHumanDecimalToAtomic(human, TREASURY_USDT_V1_DECIMALS)).toEqual({
      ok: true,
      atomic: "9007199254740993000000",
    });
    expect(String(Math.round(Number(human) * 10 ** TREASURY_USDT_V1_DECIMALS))).not.toBe(
      "9007199254740993000000",
    );
  });

  it("rejects extra precision instead of using IEEE 2-decimal rounding drift", () => {
    const result = parseHumanDecimalToAtomic("1.005", 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PRECISION");
    expect(parseHumanDecimalToAtomic("1.00", 2)).toEqual({ ok: true, atomic: "100" });
    expect(Math.round(1.005 * 100)).toBe(100);
  });
});
