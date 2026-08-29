import { describe, expect, it } from "vitest";

import {
  computePatternMatchScore,
  meetsPatternMatchThreshold,
  parsePatternDefinitionJson,
} from "@/lib/trader/mi/pattern-catalog-scoring";
import type { PatternDefinition } from "@/lib/trader/mi/pattern.types";
import { compareDecimal } from "@/lib/trader/risk/numeric";

const definition: PatternDefinition = {
  measurements: [{ measurementKey: "m1", measurementDefinitionDigest: "d1" }],
  recurrence: {
    description: "zscore spike structure",
    params: {
      zscoreAbsMin: 1,
      volMin: 0.5,
      eventRiskMax: 0.8,
    },
  },
};

describe("pattern catalog scoring (M6)", () => {
  it("bounds match score to 0..1", () => {
    const score = computePatternMatchScore({
      definition,
      features: {
        close: "100",
        zscoreVsSma20: "2.5",
        priceDispersion20: "1.2",
        eventRiskScore: "0.2",
      },
    });

    expect(compareDecimal(score.matchScore, "0")).toBeGreaterThanOrEqual(0);
    expect(compareDecimal(score.matchScore, "1")).toBeLessThanOrEqual(0);
  });

  it("is deterministic", () => {
    const features = {
      close: "100",
      zscoreVsSma20: "1.5",
      priceDispersion20: "0.8",
      eventRiskScore: "0.3",
    };
    expect(computePatternMatchScore({ definition, features })).toEqual(
      computePatternMatchScore({ definition, features }),
    );
  });

  it("parses pattern definition json", () => {
    const parsed = parsePatternDefinitionJson(JSON.stringify(definition));
    expect(parsed.recurrence.params?.zscoreAbsMin).toBe(1);
  });

  it("applies match threshold gate", () => {
    expect(meetsPatternMatchThreshold("0.2999")).toBe(false);
    expect(meetsPatternMatchThreshold("0.3000")).toBe(true);
  });
});
