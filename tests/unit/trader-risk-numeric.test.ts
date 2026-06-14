import { describe, expect, it } from "vitest";

import {
  absDecimal,
  compareDecimal,
  divideDecimal,
  formatDecimal,
  InvalidDecimalError,
  multiplyDecimal,
  parseDecimal,
  riskReasonCodes,
} from "@/lib/trader/risk";

describe("trader risk numeric helpers (DEE-238)", () => {
  it("parseDecimal and formatDecimal round-trip", () => {
    expect(formatDecimal(parseDecimal("65000.00"))).toBe("65000");
    expect(formatDecimal(parseDecimal("0.01"))).toBe("0.01");
    expect(formatDecimal(parseDecimal("-1.25"))).toBe("-1.25");
  });

  it("compareDecimal orders values correctly", () => {
    expect(compareDecimal("1.0", "2.0")).toBe(-1);
    expect(compareDecimal("2.0", "2.0")).toBe(0);
    expect(compareDecimal("3.0", "2.0")).toBe(1);
  });

  it("multiplyDecimal computes notional", () => {
    expect(multiplyDecimal("65000", "0.01")).toBe("650");
    expect(multiplyDecimal("100", "0.5")).toBe("50");
  });

  it("divideDecimal floors toward zero at scale", () => {
    expect(divideDecimal("650", "65000")).toBe("0.01");
  });

  it("rejects invalid decimal strings", () => {
    expect(() => parseDecimal("")).toThrow(InvalidDecimalError);
    expect(() => parseDecimal("1.2.3")).toThrow(InvalidDecimalError);
    expect(() => parseDecimal("1.123456789")).toThrow(InvalidDecimalError);
  });

  it("absDecimal returns magnitude", () => {
    expect(absDecimal("-150.00")).toBe("150");
    expect(absDecimal("150.00")).toBe("150");
  });
});

describe("trader risk reason codes (DEE-238)", () => {
  it("exposes stable trade-abuse codes", () => {
    expect(riskReasonCodes.symbolNotAllowed).toBe("RISK_SYMBOL_NOT_ALLOWED");
    expect(riskReasonCodes.maxNotionalExceeded).toBe("RISK_MAX_NOTIONAL_EXCEEDED");
    expect(riskReasonCodes.orderRateExceeded).toBe("RISK_ORDER_RATE_EXCEEDED");
    expect(riskReasonCodes.priceCollarBreached).toBe("RISK_PRICE_COLLAR_BREACHED");
  });
});
