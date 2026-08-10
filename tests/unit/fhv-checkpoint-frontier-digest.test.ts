import { describe, expect, it } from "vitest";

import { computeOrderFillFrontierDigest } from "@/lib/trader/observability/fhv-execution-checkpoint";

describe("fhv orderFillFrontier digest", () => {
  it("is non-zero for empty fill sequence (not 0x64 placeholder)", () => {
    const digest = computeOrderFillFrontierDigest([]);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toBe("0".repeat(64));
  });

  it("is stable for identical fill id sequences", () => {
    const ids = ["fill-a", "fill-b", "fill-c"];
    expect(computeOrderFillFrontierDigest(ids)).toBe(computeOrderFillFrontierDigest(ids));
  });

  it("changes when fill sequence changes", () => {
    expect(computeOrderFillFrontierDigest(["a"])).not.toBe(
      computeOrderFillFrontierDigest(["a", "b"]),
    );
  });
});
