import { describe, expect, it } from "vitest";

import { subtractDecimal } from "@/lib/trader/risk/numeric";
import { deriveFhvPnlFromOperatorCapital } from "@/lib/trader/readiness/build-fhv-pnl-report.v1";

describe("DEE-436 FHV PnL operator capital derivation", () => {
  it("computes net PnL as final minus initial minus costs", () => {
    const result = deriveFhvPnlFromOperatorCapital("100000", "105000", "500");
    expect(result.grossPnlUsdt).toBe("5000");
    expect(result.netPnlUsdt).toBe("4500");
  });

  it("handles loss path with cost drag", () => {
    const result = deriveFhvPnlFromOperatorCapital("100000", "98000", "200");
    expect(result.grossPnlUsdt).toBe(subtractDecimal("98000", "100000"));
    expect(result.netPnlUsdt).toBe(subtractDecimal(result.grossPnlUsdt, "200"));
  });

  it("defaults execution costs to zero", () => {
    const result = deriveFhvPnlFromOperatorCapital("100000", "101000");
    expect(result.grossPnlUsdt).toBe("1000");
    expect(result.netPnlUsdt).toBe("1000");
  });
});
