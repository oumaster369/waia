import { describe, expect, it } from "vitest";

import {
  applyRiskMultiplierToQuantity,
  clampRiskMultiplierDownwardOnly,
} from "@/lib/trader/paper/apply-risk-multiplier";

describe("HTR-WP16 risk multiplier", () => {
  it("clamps upward values to 1", () => {
    expect(clampRiskMultiplierDownwardOnly(1.5)).toBe(1);
    expect(clampRiskMultiplierDownwardOnly(1)).toBe(1);
  });

  it("returns zero quantity for zero multiplier", () => {
    expect(applyRiskMultiplierToQuantity("1.5", 0)).toBe("0");
  });

  it("scales quantity downward for fractional multiplier", () => {
    expect(applyRiskMultiplierToQuantity("2", 0.5)).toBe("1");
  });
});
