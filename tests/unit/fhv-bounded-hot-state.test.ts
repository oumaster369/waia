import { describe, expect, it } from "vitest";

import {
  assessFhvBoundedHotState,
  FHV_UNBOUNDED_SUSTAINED_BYTES_PER_CYCLE,
} from "@/lib/trader/observability/fhv-bounded-hot-state";

function series(points: readonly (readonly [number, number])[]) {
  return points.map(([cycle, bytes]) => ({
    globalEventSequence: cycle,
    sqliteDatabaseBytes: bytes,
  }));
}

describe("FHV bounded hot-state assessor (AD-1)", () => {
  it("classifies startup fill-up followed by a stable plateau as BOUNDED", () => {
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

  it("classifies plateau then resumed growth as UNBOUNDED", () => {
    const result = assessFhvBoundedHotState(
      series([
        [0, 256_000],
        [1_000, 2_662_400],
        [2_000, 2_662_400],
        [3_000, 2_662_400],
        [4_000, 2_662_400],
        [5_000, 2_982_400],
        [6_000, 3_302_400],
        [7_000, 3_622_400],
      ]),
    );
    expect(result.classification).toBe("UNBOUNDED");
  });

  it("fails closed on insufficient plateau observations", () => {
    const result = assessFhvBoundedHotState(
      series([
        [0, 100_000],
        [500, 400_000],
        [1_000, 800_000],
      ]),
    );
    expect(result.classification).toBe("INSUFFICIENT_EVIDENCE");
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
