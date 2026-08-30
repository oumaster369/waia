import { describe, expect, it } from "vitest";

import { resolveFhvRealHtxPageToSeconds } from "@/lib/trader/market-data/fhv-real-htx-acquisition";

const MINUTE = 60;

describe("FHV real HTX provider page window", () => {
  it("bounds the first and subsequent requests to the requested candle count", () => {
    const partitionEnd = 1_672_531_200;
    const pageSize = 1_000;
    const firstFrom = 1_577_836_800;
    const firstTo = resolveFhvRealHtxPageToSeconds({
      fromSeconds: firstFrom,
      endExclusiveSeconds: partitionEnd,
      pageSize,
    });
    expect(firstTo).toBe(firstFrom + (pageSize - 1) * MINUTE);

    const secondFrom = firstTo + MINUTE;
    const secondTo = resolveFhvRealHtxPageToSeconds({
      fromSeconds: secondFrom,
      endExclusiveSeconds: partitionEnd,
      pageSize,
    });
    expect(secondFrom).toBe(firstTo + MINUTE);
    expect(secondTo).toBe(secondFrom + (pageSize - 1) * MINUTE);
  });

  it("clamps the final request to the inclusive partition boundary without overlap or gap", () => {
    const partitionEnd = 1_672_531_200;
    const pageSize = 1_000;
    const finalFrom = partitionEnd - 17 * MINUTE;
    const finalTo = resolveFhvRealHtxPageToSeconds({
      fromSeconds: finalFrom,
      endExclusiveSeconds: partitionEnd,
      pageSize,
    });
    expect(finalTo).toBe(partitionEnd - 1);
    expect(finalTo).toBeGreaterThanOrEqual(finalFrom + 16 * MINUTE);
    expect(finalTo).toBeLessThan(finalFrom + 17 * MINUTE);
  });

  it("rejects non-positive page sizes", () => {
    expect(() =>
      resolveFhvRealHtxPageToSeconds({
        fromSeconds: 1_577_836_800,
        endExclusiveSeconds: 1_672_531_200,
        pageSize: 0,
      }),
    ).toThrow("positive integer");
  });
});
