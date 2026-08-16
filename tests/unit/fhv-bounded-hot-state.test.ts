import { describe, expect, it } from "vitest";

import {
  assessFhvBoundedHotState,
  FHV_BOUNDED_HOT_STATE_PAGE_ENVELOPE_BYTES,
  FHV_UNBOUNDED_SUSTAINED_BYTES_PER_CYCLE,
} from "@/lib/trader/observability/fhv-bounded-hot-state";

function series(points: readonly (readonly [number, number])[]) {
  return points.map(([cycle, bytes]) => ({
    globalEventSequence: cycle,
    sqliteDatabaseBytes: bytes,
  }));
}

describe("FHV bounded hot-state assessor (AD-1)", () => {
  it("classifies startup fill-up followed by a stable terminal plateau as BOUNDED", () => {
    const result = assessFhvBoundedHotState(
      series([
        [0, 256_000],
        [1_000, 1_200_000],
        [2_000, 2_662_400],
        [3_000, 2_662_400],
        [4_000, 2_662_400],
        [5_000, 2_662_400],
        [6_000, 2_662_400],
      ]),
    );
    expect(result.classification).toBe("BOUNDED");
  });

  it("does not classify plateau then sustained +200 B/cycle as BOUNDED", () => {
    const result = assessFhvBoundedHotState(
      series([
        [0, 256_000],
        [1_000, 2_662_400],
        [2_000, 2_662_400],
        [3_000, 2_662_400],
        [4_000, 2_662_400],
        [5_000, 2_662_600],
        [6_000, 2_662_800],
        [7_000, 2_663_000],
        [8_000, 2_663_200],
      ]),
    );
    expect(result.classification).not.toBe("BOUNDED");
    expect(result.classification).toBe("UNBOUNDED");
  });

  it("does not classify plateau then +100 B/cycle long enough to exceed the envelope as BOUNDED", () => {
    const plateau = 2_662_400;
    const result = assessFhvBoundedHotState(
      series([
        [0, 256_000],
        [1_000, plateau],
        [2_000, plateau],
        [3_000, plateau],
        [4_000, plateau],
        [5_000, plateau + 100_000],
        [6_000, plateau + 200_000],
        [7_000, plateau + 300_000],
      ]),
    );
    expect(plateau + 300_000 - plateau).toBeGreaterThan(FHV_BOUNDED_HOT_STATE_PAGE_ENVELOPE_BYTES);
    expect(result.classification).not.toBe("BOUNDED");
    expect(result.classification).toBe("UNBOUNDED");
  });

  it("classifies a single page/envelope bump followed by a stable terminal plateau as BOUNDED", () => {
    const plateau = 2_662_400;
    const bumped = plateau + 65_536;
    const result = assessFhvBoundedHotState(
      series([
        [0, 256_000],
        [1_000, plateau],
        [2_000, plateau],
        [3_000, plateau],
        [4_000, bumped],
        [5_000, bumped],
        [6_000, bumped],
        [7_000, bumped],
      ]),
    );
    expect(result.classification).toBe("BOUNDED");
  });

  it("classifies persistent ~320 B/cycle growth as UNBOUNDED", () => {
    const result = assessFhvBoundedHotState(
      series(
        [0, 1, 2, 3, 4, 5, 6, 7].map((step) => {
          const cycle = step * 500;
          return [cycle, 100_000 + 320 * cycle] as const;
        }),
      ),
    );
    expect(result.classification).toBe("UNBOUNDED");
    expect(FHV_UNBOUNDED_SUSTAINED_BYTES_PER_CYCLE).toBe(256);
  });

  it("fails closed on insufficient terminal plateau evidence", () => {
    expect(
      assessFhvBoundedHotState(
        series([
          [0, 100_000],
          [500, 400_000],
          [1_000, 800_000],
        ]),
      ).classification,
    ).toBe("INSUFFICIENT_EVIDENCE");
    expect(
      assessFhvBoundedHotState(
        series([
          [0, 100],
          [1, 200],
          [2, 300],
          [3, 400],
        ]),
      ).classification,
    ).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("classifies flat bounded sizes across many cycles as BOUNDED", () => {
    const result = assessFhvBoundedHotState(
      series([0, 1, 2, 3, 4, 5, 6].map((step) => [step * 1_000, 2_662_400] as const)),
    );
    expect(result.classification).toBe("BOUNDED");
  });

  it("does not let transient prune decreases hide later resumed growth", () => {
    const result = assessFhvBoundedHotState(
      series([
        [0, 256_000],
        [1_000, 2_662_400],
        [2_000, 2_662_400],
        [3_000, 1_800_000],
        [4_000, 2_100_000],
        [5_000, 2_500_000],
        [6_000, 2_900_000],
        [7_000, 3_300_000],
      ]),
    );
    expect(result.classification).toBe("UNBOUNDED");
  });

  it("is deterministic for an identical series", () => {
    const input = series([
      [0, 2_000_000],
      [1_000, 2_000_000],
      [2_000, 2_000_000],
      [3_000, 2_000_000],
    ]);
    expect(assessFhvBoundedHotState(input)).toEqual(assessFhvBoundedHotState(input));
  });
});
