import { describe, expect, it } from "vitest";

import {
  computeReadinessResult,
  computeTotalCompletionPercent,
  parseIndicatorVector,
  type ReadinessInput,
} from "@/lib/readiness";
import { ReadinessValidationError } from "@/lib/readiness/types";

function input(partial: Omit<ReadinessInput, "socializationCompleted" | "finalStateMessageShown"> & Partial<Pick<ReadinessInput, "socializationCompleted" | "finalStateMessageShown">>): ReadinessInput {
  return {
    indicators: partial.indicators,
    socializationCompleted: partial.socializationCompleted ?? false,
    finalStateMessageShown: partial.finalStateMessageShown ?? false,
  };
}

describe("parseIndicatorVector / computeTotalCompletionPercent", () => {
  it("implements readiness model §9.1 (all Initiated)", () => {
    const v = parseIndicatorVector([33, 33, 33, 33, 33, 33]);
    expect(computeTotalCompletionPercent(v)).toBe(33);
  });

  it("implements readiness model §9.2 Diary threshold sequence", () => {
    const mid1 = parseIndicatorVector([67, 67, 67, 33, 33, 33]);
    expect(computeTotalCompletionPercent(mid1)).toBe(50);

    const mid2 = parseIndicatorVector([67, 67, 67, 67, 33, 33]);
    expect(computeTotalCompletionPercent(mid2)).toBe(55);

    const diaryUnlocked = parseIndicatorVector([67, 67, 67, 67, 67, 33]);
    expect(computeTotalCompletionPercent(diaryUnlocked)).toBe(61);
  });

  it("implements readiness model §9.3 ReadyForSocialization totals", () => {
    const v = parseIndicatorVector([100, 100, 100, 100, 100, 100]);
    expect(computeTotalCompletionPercent(v)).toBe(100);
  });

  it("rejects disambiguation percentages 34 and 66 (never stored §6.5)", () => {
    expect(() => parseIndicatorVector([34, 0, 0, 0, 0, 0])).toThrow(ReadinessValidationError);
    expect(() => parseIndicatorVector([66, 0, 0, 0, 0, 0])).toThrow(ReadinessValidationError);
  });

  it("rejects malformed vectors", () => {
    expect(() => parseIndicatorVector([33, 33, 33, 33, 33])).toThrow(ReadinessValidationError);
    expect(() => parseIndicatorVector([-1, 33, 33, 33, 33, 33])).toThrow(ReadinessValidationError);
    expect(() => parseIndicatorVector([67.25, 0, 0, 0, 0, 0])).toThrow(ReadinessValidationError);
  });
});

describe("computeReadinessResult", () => {
  it("surfaces Diary unlock strictly at totals >=60 (§7.3)", () => {
    const below59 = computeReadinessResult(
      input({
        indicators: [33, 33, 33, 33, 33, 33],
      }),
    );
    expect(below59.diaryTabUnlocked).toBe(false);

    const crosses = computeReadinessResult(
      input({
        indicators: [67, 67, 67, 67, 67, 33],
      }),
    );
    expect(crosses.totalCompletionPercent).toBe(61);
    expect(crosses.diaryTabUnlocked).toBe(true);
  });

  it("never unlocks Society from readiness alone — only socialization boolean (§5.4 user-flow)", () => {
    const top = computeReadinessResult(
      input({
        indicators: [100, 100, 100, 100, 100, 100],
        socializationCompleted: false,
      }),
    );

    expect(top.societyTabUnlocked).toBe(false);
    expect(top.readyForSocialization).toBe(true);

    const afterSocialization = computeReadinessResult(
      input({
        indicators: [100, 100, 100, 100, 100, 100],
        socializationCompleted: true,
      }),
    );

    expect(afterSocialization.societyTabUnlocked).toBe(true);
    expect(afterSocialization.readyForSocialization).toBe(false);
  });

  it("shows final twin banner only before finalStateMessageShown stores true", () => {
    const pendingBanner = computeReadinessResult(
      input({
        indicators: [100, 100, 100, 100, 100, 100],
        socializationCompleted: true,
        finalStateMessageShown: false,
      }),
    );
    expect(pendingBanner.showFinalTwinCompletionState).toBe(true);

    const hydrated = computeReadinessResult(
      input({
        indicators: [100, 100, 100, 100, 100, 100],
        socializationCompleted: true,
        finalStateMessageShown: true,
      }),
    );

    expect(hydrated.showFinalTwinCompletionState).toBe(false);
  });

  it("returns scores keyed for every indicator dimension", () => {
    const r = computeReadinessResult(input({ indicators: [33, 67, 0, 33, 100, 67] }));
    expect(r.scoresByIndicator.values).toBe(33);
    expect(r.scoresByIndicator.behavior).toBe(67);
    expect(r.scoresByIndicator.thinking).toBe(0);
    expect(r.scoresByIndicator.emotions).toBe(33);
    expect(r.scoresByIndicator.interests).toBe(100);
    expect(r.scoresByIndicator.goals).toBe(67);
  });
});
