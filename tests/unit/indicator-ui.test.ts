import { describe, expect, it } from "vitest";

import {
  buildIndicatorPresentation,
  getIndicatorHint,
  getIndicatorThresholdBand,
} from "@/lib/dashboard/indicator-ui";
import type { IndicatorVector } from "@/lib/readiness/types";

describe("indicator-ui", () => {
  it("maps indicator percents to threshold bands", () => {
    expect(getIndicatorThresholdBand(0)).toBe("low");
    expect(getIndicatorThresholdBand(33)).toBe("medium");
    expect(getIndicatorThresholdBand(67)).toBe("medium");
    expect(getIndicatorThresholdBand(100)).toBe("high");
  });

  it("returns stable hints for sample key×percent pairs", () => {
    expect(getIndicatorHint("values", 0)).toContain("values signal");
    expect(getIndicatorHint("behavior", 100)).toContain("confirmed");
    expect(getIndicatorHint("goals", 67)).toContain("lived steps");
    expect(getIndicatorHint("thinking", 33)).toContain("thought-pattern");
  });

  it("buildIndicatorPresentation aligns with IndicatorVector order and bands", () => {
    const v: IndicatorVector = [0, 33, 67, 100, 0, 100];
    const rows = buildIndicatorPresentation(v);
    expect(rows).toHaveLength(6);
    expect(rows[0]!.key).toBe("values");
    expect(rows[0]!.band).toBe("low");
    expect(rows[1]!.band).toBe("medium");
    expect(rows[2]!.band).toBe("medium");
    expect(rows[3]!.band).toBe("high");
    expect(rows[4]!.band).toBe("low");
    expect(rows[5]!.band).toBe("high");
  });
});
