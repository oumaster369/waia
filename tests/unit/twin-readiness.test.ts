import { describe, expect, it } from "vitest";

import type { TwinReadinessInput } from "@/lib/dashboard/twin-readiness-api.types";
import {
  computeTwinReadinessResult,
  twinReadinessContradictionsScore,
  twinReadinessFeedbackScore,
  twinReadinessLevel,
  twinReadinessOverallScore,
  TWIN_READINESS_SCHEMA_VERSION,
  TWIN_READINESS_WEIGHTS,
} from "@/lib/reasoning/twin-readiness";

function maxedExceptBase(overrides: Partial<TwinReadinessInput> = {}): TwinReadinessInput {
  return {
    baseModelAnsweredCount: 0,
    memoryFusedItemCount: 500,
    patternMemoryItemsConsidered: 80,
    contradictionFindingCount: 6,
    contradictionMemoryItemsConsidered: 8,
    repeatabilityTotalOccurrences: 2,
    verificationCountByKind: {
      accurate: 12,
      partially_accurate: 10,
      inaccurate: 8,
    },
    ...overrides,
  };
}

describe("twin readiness v1 (DEE-22)", () => {
  it("empty / zero snapshot → low level and overall below medium band", () => {
    const r = computeTwinReadinessResult({
      baseModelAnsweredCount: 0,
      memoryFusedItemCount: 0,
      patternMemoryItemsConsidered: 0,
      contradictionFindingCount: 0,
      contradictionMemoryItemsConsidered: 0,
      repeatabilityTotalOccurrences: 0,
      verificationCountByKind: {},
    });
    expect(r.schemaVersion).toBe(TWIN_READINESS_SCHEMA_VERSION);
    expect(r.level).toBe("low");
    expect(r.overall).toBeLessThan(0.4);
    for (const v of Object.values(r.scores)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("large memory and rich signals but no base model answers → never high readiness", () => {
    const r = computeTwinReadinessResult(maxedExceptBase());
    expect(r.level).not.toBe("high");
    expect(r.overall).toBeLessThanOrEqual(0.7);
    expect(r.scores.baseModel).toBe(0);
  });

  it("many identical verifications (one kind) limits feedback vs diverse same total", () => {
    const total = 30;
    const single = twinReadinessFeedbackScore({ accurate: total });
    const spread = twinReadinessFeedbackScore({
      accurate: 10,
      partially_accurate: 10,
      inaccurate: 10,
    });
    expect(spread).toBeGreaterThan(single);
    expect(single).toBeGreaterThan(0);
  });

  it("no contradiction findings → contradiction score not in top band", () => {
    const s = twinReadinessContradictionsScore({
      contradictionFindingCount: 0,
      contradictionMemoryItemsConsidered: 0,
    });
    expect(s).toBeLessThan(0.6);
    expect(s).toBeGreaterThanOrEqual(0.2);
  });

  it("high repeatability occurrences reduce consistency vs calm baseline", () => {
    const baseInput: TwinReadinessInput = {
      baseModelAnsweredCount: 5,
      memoryFusedItemCount: 20,
      patternMemoryItemsConsidered: 20,
      contradictionFindingCount: 0,
      contradictionMemoryItemsConsidered: 0,
      repeatabilityTotalOccurrences: 0,
      verificationCountByKind: {},
    };
    const r1 = computeTwinReadinessResult(baseInput);
    const r2 = computeTwinReadinessResult({
      ...baseInput,
      repeatabilityTotalOccurrences: 400,
    });
    expect(r2.scores.consistency).toBeLessThan(r1.scores.consistency);
  });

  it("determinism: same input → identical result", () => {
    const input = maxedExceptBase({ baseModelAnsweredCount: 4 });
    expect(computeTwinReadinessResult(input)).toEqual(computeTwinReadinessResult({ ...input }));
  });

  it("weights sum to 1", () => {
    const sum = Object.values(TWIN_READINESS_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it("overall and subscores are clamped and rounded to 4 decimals", () => {
    const r = computeTwinReadinessResult({
      baseModelAnsweredCount: 10,
      memoryFusedItemCount: 100,
      patternMemoryItemsConsidered: 50,
      contradictionFindingCount: 2,
      contradictionMemoryItemsConsidered: 4,
      repeatabilityTotalOccurrences: 12,
      verificationCountByKind: { accurate: 5, partially_accurate: 3 },
    });
    expect(r.overall).toBe(Math.round(r.overall * 10000) / 10000);
    expect(twinReadinessLevel(r.overall)).toBe(r.level);
    expect(r.overall).toBe(twinReadinessOverallScore(r.scores));
  });

  it("patterns score is 0 without minimum fused memory", () => {
    const r = computeTwinReadinessResult({
      baseModelAnsweredCount: 10,
      memoryFusedItemCount: 2,
      patternMemoryItemsConsidered: 100,
      contradictionFindingCount: 0,
      contradictionMemoryItemsConsidered: 0,
      repeatabilityTotalOccurrences: 0,
      verificationCountByKind: {},
    });
    expect(r.scores.patterns).toBe(0);
  });

  it("full base model with strong signals can reach high band", () => {
    const r = computeTwinReadinessResult(
      maxedExceptBase({
        baseModelAnsweredCount: 10,
        repeatabilityTotalOccurrences: 1,
      }),
    );
    expect(r.scores.baseModel).toBe(1);
    expect(r.overall).toBeGreaterThan(0.7);
    expect(r.level).toBe("high");
  });
});
