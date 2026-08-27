import { describe, expect, it } from "vitest";

import {
  ContributionIntentError,
  formatUsdtAtomic,
  parseUsdtAmount,
} from "@/lib/waia-core/treasury/contributions/payment-intents";

describe("DEE-731 contribution payment intent money contract", () => {
  it("parses exact six-decimal USDT without floating point", () => {
    expect(parseUsdtAmount("1")).toBe(1_000_000n);
    expect(parseUsdtAmount("100.25")).toBe(100_250_000n);
    expect(parseUsdtAmount("999999.999999")).toBe(999_999_999_999n);
  });

  it("rejects ambiguous, sub-minimum and excessive amounts", () => {
    for (const value of ["0", "0.999999", "1.0000001", "1e3", "-5", "1000001"]) {
      expect(() => parseUsdtAmount(value)).toThrow(ContributionIntentError);
    }
  });

  it("formats the copyable exact amount without rounding", () => {
    expect(formatUsdtAtomic(100_000_123n)).toBe("100.000123");
  });
});
