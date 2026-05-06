import { describe, expect, it } from "vitest";

import type { TwinMemorySearchHit } from "@/lib/twin-persistence/twin-memory-retrieval";
import { fuseMemorySearchSlices } from "@/lib/reasoning/twin-memory-search-fusion";

function hit(o: Omit<TwinMemorySearchHit, "score"> & { score?: number }): TwinMemorySearchHit {
  return {
    score: o.score ?? 0.5,
    source: o.source,
    id: o.id,
    previewText: o.previewText,
  };
}

describe("fuseMemorySearchSlices (DEE-72.4)", () => {
  it("dedupes stable keys keeping max score", () => {
    const fused = fuseMemorySearchSlices(
      [
        [hit({ source: "diary", id: "a", previewText: "x", score: 0.1 })],
        [
          hit({ source: "diary", id: "a", previewText: "y", score: 0.9 }),
          hit({ source: "dialogue", id: "b", previewText: "z", score: 0.2 }),
        ],
      ],
      40,
    );
    expect(fused).toHaveLength(2);
    const maxA = fused.find((h) => h.id === "a");
    expect(maxA?.score).toBe(0.9);
    expect(maxA?.previewText).toBe("y");
  });

  it("tie-break sorts by scores then source:id lexicographically", () => {
    const fused = fuseMemorySearchSlices(
      [
        [
          hit({ source: "scenario", id: "1", previewText: "", score: 0.5 }),
          hit({ source: "dialogue", id: "9", previewText: "", score: 0.5 }),
        ],
      ],
      10,
    );
    const keys = fused.map((h) => `${h.source}:${h.id}`);
    const sorted = [...keys].sort((ka, kb) => ka.localeCompare(kb));
    expect(keys).toEqual(sorted);
  });

  it("respects maxFusedItems after merge", () => {
    const s1 = ["a", "b", "c"].map((id) =>
      hit({ source: "diary", id, previewText: id, score: Number(id.charCodeAt(0)) / 200 }),
    );
    const s2 = ["d", "e", "f"].map((id) =>
      hit({ source: "diary", id, previewText: id, score: Number(id.charCodeAt(0)) / 200 }),
    );
    expect(fuseMemorySearchSlices([s1, s2], 2)).toHaveLength(2);
  });
});
