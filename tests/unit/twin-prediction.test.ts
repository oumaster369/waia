import { describe, expect, it } from "vitest";

import {
  TWIN_PATTERN_SUMMARY_SCHEMA_VERSION,
  type TwinPatternSummaryApiResponse,
} from "@/lib/dashboard/twin-pattern-summary-api.types";
import type { TwinMemorySearchHit } from "@/lib/twin-persistence/twin-memory-retrieval";
import { buildTwinPredictionFromInputs } from "@/lib/reasoning/twin-prediction";

function summary(over: Partial<TwinPatternSummaryApiResponse> = {}): TwinPatternSummaryApiResponse {
  return {
    schemaVersion: TWIN_PATTERN_SUMMARY_SCHEMA_VERSION,
    repeatedBehaviors: [],
    emotionalPatterns: [],
    decisionTendencies: [],
    contradictions: [],
    dominantThemes: [],
    memoryItemsConsidered: 0,
    seedQueryCount: 7,
    ...over,
  };
}

function hit(p: Omit<TwinMemorySearchHit, "score"> & { score?: number }): TwinMemorySearchHit {
  return { score: p.score ?? 0.4, source: p.source, id: p.id, previewText: p.previewText };
}

describe("buildTwinPredictionFromInputs", () => {
  it("returns identical predictions for identical inputs", () => {
    const hits = [
      hit({ source: "diary", id: "1", previewText: "prefers steady planning", score: 0.2 }),
    ];
    const s = summary({
      memoryItemsConsidered: 12,
      dominantThemes: ["Theme (mentions=2): robotics"],
      emotionalPatterns: [],
    });
    const norm = "if we launch next month what breaks";
    const a = buildTwinPredictionFromInputs(norm, s, hits);
    const b = buildTwinPredictionFromInputs(norm, s, [...hits]);
    expect(a).toEqual(b);
  });

  it("uses sparse-memory fallback when no hits and zero pattern fused items", () => {
    const r = buildTwinPredictionFromInputs("what happens tomorrow", summary(), []);
    expect(r.confidence).toBe(0.2);
    expect(r.outcome.toLowerCase()).toContain("insufficient twin memory");
    expect(r.reasoning.some((line) => line.toLowerCase().includes("memoryitemsconsidered=0"))).toBe(true);
  });

  it("scenario text changes projections when hits and summary are fixed", () => {
    const hits = [
      hit({ source: "diary", id: "a", previewText: "calm pacing", score: 0.1 }),
    ];
    const s = summary({ memoryItemsConsidered: 3, dominantThemes: ["Theme (mentions=2): pacing"] });
    const p1 = buildTwinPredictionFromInputs("scenario alpha variant zebra", s, hits);
    const p2 = buildTwinPredictionFromInputs("scenario beta variant yak", s, hits);
    expect(p1).not.toEqual(p2);
  });

  it("contradictions in pattern summary temper confidence deterministically", () => {
    const hits = [
      hit({ source: "diary", id: "1", previewText: "deadline work", score: 0.3 }),
      hit({ source: "diary", id: "2", previewText: "weekend recharge", score: 0.2 }),
    ];
    const base = summary({
      memoryItemsConsidered: 8,
      dominantThemes: ["Theme (mentions=2): robotics"],
      emotionalPatterns: [],
      contradictions: [],
    });
    const withCx = summary({
      ...base,
      contradictions: ['Contrast between memories: "calm" vs "anxious"'],
    });
    const scenario = "ship before the deadline quietly";
    const a = buildTwinPredictionFromInputs(scenario, base, hits);
    const b = buildTwinPredictionFromInputs(scenario, withCx, hits);
    expect(b.confidence).toBeLessThanOrEqual(a.confidence);
    expect(b.reasoning.some((line) => line.toLowerCase().includes("contradictions=1"))).toBe(true);
  });

  it("deadline-plus-stress overlay triggers additional reasoning when signals align", () => {
    const hits = [
      hit({ source: "diary", id: "1", previewText: "anxious about launch", score: 0.15 }),
    ];
    const s = summary({
      memoryItemsConsidered: 6,
      emotionalPatterns: ["Emotional pattern: stress"],
      dominantThemes: [],
    });
    const r = buildTwinPredictionFromInputs("the sprint deadline is tomorrow", s, hits);
    expect(r.outcome.toLowerCase()).toContain("time-pressure");
    expect(r.reasoning.some((l) => l.includes("deadline-plus-stress-patterns"))).toBe(true);
  });
});
