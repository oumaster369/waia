import { describe, expect, it } from "vitest";

import {
  computePatternAgingDecay,
  computePatternRelevanceScore,
} from "@/lib/trader/mi/pattern-catalog-aging";
import { compareDecimal } from "@/lib/trader/risk/numeric";

describe("pattern catalog aging (M6)", () => {
  it("decays relevance monotonically with age", () => {
    const young = computePatternRelevanceScore({
      matchScore: "1",
      ageBars: 10,
      halfLifeBars: 120,
    });
    const old = computePatternRelevanceScore({
      matchScore: "1",
      ageBars: 240,
      halfLifeBars: 120,
    });

    expect(compareDecimal(old, young)).toBeLessThan(0);
  });

  it("returns full decay weight at age zero", () => {
    expect(computePatternAgingDecay({ ageBars: 0 })).toBe("1");
  });
});
