import { describe, expect, it } from "vitest";

import { eventClassificationKinds } from "@/lib/trader/events/event-classification-kinds";
import {
  computeEventAttributionBreakdown,
  deriveAttributionOutcomeTag,
  meetsEventAttributionThreshold,
} from "@/lib/trader/events/event-attribution-rules";
import { compareDecimal } from "@/lib/trader/risk/numeric";

describe("event attribution rules (M7)", () => {
  it("bounds attribution strength to 0..1", () => {
    const breakdown = computeEventAttributionBreakdown({
      classificationKind: eventClassificationKinds.volatilitySpike,
      eventMs: Date.parse("2026-01-01T12:00:00.000Z"),
      subjectMs: Date.parse("2026-01-01T12:00:00.000Z"),
      features: {
        close: "100",
        zscoreVsSma20: "2",
        priceDispersion20: "1.5",
        regime: "RANGE",
      },
    });
    expect(compareDecimal(breakdown.attributionStrength, "0")).toBeGreaterThanOrEqual(0);
    expect(compareDecimal(breakdown.attributionStrength, "1")).toBeLessThanOrEqual(0);
    expect(meetsEventAttributionThreshold(breakdown.attributionStrength)).toBe(true);
  });

  it("uses descriptive outcome tags without PnL framing", () => {
    const breakdown = computeEventAttributionBreakdown({
      classificationKind: eventClassificationKinds.volatilitySpike,
      eventMs: 0,
      subjectMs: 0,
      features: {
        close: "100",
        zscoreVsSma20: "2",
        priceDispersion20: "1.5",
        regime: "RANGE",
      },
    });
    const tag = deriveAttributionOutcomeTag({
      classificationKind: eventClassificationKinds.volatilitySpike,
      breakdown,
    });
    expect(["supporting", "contradicting", "neutral"]).toContain(tag);
  });

  it("applies attribution threshold gate", () => {
    expect(meetsEventAttributionThreshold("0.2499")).toBe(false);
    expect(meetsEventAttributionThreshold("0.2500")).toBe(true);
  });
});
