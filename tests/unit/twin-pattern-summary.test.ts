import { describe, expect, it } from "vitest";

import { TWIN_PATTERN_SUMMARY_SCHEMA_VERSION } from "@/lib/dashboard/twin-pattern-summary-api.types";
import type { TwinMemorySearchHit } from "@/lib/twin-persistence/twin-memory-retrieval";
import {
  buildTwinPatternSummaryFromHits,
  PATTERN_SUMMARY_SEED_QUERIES,
  retrieveMemoriesForPatternSummaryAsync,
} from "@/lib/reasoning/twin-pattern-summary";
import type { TwinMemorySearchPort } from "@/lib/reasoning/twin-reasoning-ports";

function hit(o: Omit<TwinMemorySearchHit, "score"> & { score?: number }): TwinMemorySearchHit {
  return {
    score: o.score ?? 0.42,
    source: o.source,
    id: o.id,
    previewText: o.previewText,
  };
}

describe("buildTwinPatternSummaryFromHits", () => {
  it("returns stable empty summary for no hits", () => {
    expect(buildTwinPatternSummaryFromHits([])).toEqual({
      schemaVersion: TWIN_PATTERN_SUMMARY_SCHEMA_VERSION,
      repeatedBehaviors: [],
      emotionalPatterns: [],
      decisionTendencies: [],
      contradictions: [],
      dominantThemes: [],
      memoryItemsConsidered: 0,
    });
  });

  it("same input twice yields byte-identical output", () => {
    const hits = [
      hit({
        source: "diary",
        id: "one",
        previewText: "robotics club welding robotics gears",
      }),
      hit({
        source: "dialogue",
        id: "two",
        previewText: "user: robotics side project nightly",
      }),
    ];
    const a = buildTwinPatternSummaryFromHits(hits);
    const b = buildTwinPatternSummaryFromHits([
      hits[0]!,
      hits[1]!,
    ]);
    expect(a).toEqual(b);
    expect(a.repeatedBehaviors.some((x) => x.includes("robotics"))).toBe(true);
    expect(a.memoryItemsConsidered).toBe(2);
  });

  it("emotion lexicon hits surface emotionalPatterns", () => {
    const r = buildTwinPatternSummaryFromHits([
      hit({ source: "diary", id: "x", previewText: "Tonight I feel exhausted from travel" }),
    ]);
    expect(
      r.emotionalPatterns.some((s) =>
        s.toLowerCase().includes("fatigue") || s.toLowerCase().includes("exhaustion"),
      ),
    ).toBe(true);
  });

  it("decision markers surface decisionTendencies", () => {
    const r = buildTwinPatternSummaryFromHits([
      hit({ source: "diary", id: "d", previewText: "Therefore I decided to postpone the deadline" }),
    ]);
    expect(
      r.decisionTendencies.some(
        (s) => s.includes("Decision tendency") || s.includes("decided outcome") || s.includes("deciding"),
      ),
    ).toBe(true);
  });

  it("detects contradiction across distinct memories using contrast pairs", () => {
    const r = buildTwinPatternSummaryFromHits([
      hit({ source: "diary", id: "a", previewText: "Today I remain calm about the rollout" }),
      hit({ source: "diary", id: "b", previewText: "Later I grew anxious waiting for uptime" }),
    ]);
    expect(
      r.contradictions.some((c) => c.includes("anxious") && c.includes("calm")),
    ).toBe(true);
  });
});

describe("retrieveMemoriesForPatternSummaryAsync", () => {
  it("fuses one hit per seed from a mock port (deterministic)", async () => {
    const perSeed = PATTERN_SUMMARY_SEED_QUERIES.map((seed, idx) =>
      hit({ source: "diary", id: String(idx), previewText: seed, score: idx * 0.01 }),
    );
    let call = 0;
    const port: TwinMemorySearchPort = {
      searchByText: async () => [perSeed[call++]!],
    };

    const got = await retrieveMemoriesForPatternSummaryAsync(port, "user-1");
    expect(call).toBe(PATTERN_SUMMARY_SEED_QUERIES.length);
    expect(got).toHaveLength(PATTERN_SUMMARY_SEED_QUERIES.length);
    const ids = [...got].sort((a, b) => Number(a.id) - Number(b.id)).map((h) => h.id);
    expect(ids).toEqual(PATTERN_SUMMARY_SEED_QUERIES.map((_, i) => String(i)));
    const sortedByScore = [...got].sort((a, b) => b.score - a.score);
    expect(got).toEqual(sortedByScore);
  });
});