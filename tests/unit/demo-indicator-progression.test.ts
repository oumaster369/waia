import { describe, expect, it } from "vitest";

import {
  DEMO_READINESS_MIN_MESSAGE_CHARS,
  planDemoReadinessAdvancement,
} from "@/lib/readiness/demo-indicator-progression";
import type { IndicatorVector } from "@/lib/readiness/types";

describe("planDemoReadinessAdvancement (v1 demo writer)", () => {
  const zeroIndicators: IndicatorVector = [0, 0, 0, 0, 0, 0];

  it("returns null when message shorter than minimum", () => {
    const short = "x".repeat(DEMO_READINESS_MIN_MESSAGE_CHARS - 1);
    expect(planDemoReadinessAdvancement(zeroIndicators, short)).toBeNull();
  });

  it("returns null without self-referential token", () => {
    const text = "This is a long enough message without the special words.";
    expect(text.length).toBeGreaterThanOrEqual(DEMO_READINESS_MIN_MESSAGE_CHARS);
    expect(planDemoReadinessAdvancement(zeroIndicators, text)).toBeNull();
  });

  it("picks lowest-valued non-100 indicator; ties resolve to lowest index", () => {
    const indicators: IndicatorVector = [33, 33, 67, 100, 100, 100];
    const plan = planDemoReadinessAdvancement(
      indicators,
      "I am giving a substantive answer about my values here.",
    );
    expect(plan).toEqual({ indicatorIndex: 0, from: 33, to: 67 });
  });

  it("returns null when every indicator is confirmed", () => {
    const indicators: IndicatorVector = [100, 100, 100, 100, 100, 100];
    expect(
      planDemoReadinessAdvancement(
        indicators,
        "I still want to share more about myself in this long message.",
      ),
    ).toBeNull();
  });

  it("advances 0→33 on first eligible turn (lowest index)", () => {
    const plan = planDemoReadinessAdvancement(
      zeroIndicators,
      "I think this is enough text for our readiness demo step.",
    );
    expect(plan).toEqual({ indicatorIndex: 0, from: 0, to: 33 });
  });
});
