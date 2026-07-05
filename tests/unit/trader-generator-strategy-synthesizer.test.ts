import { describe, expect, it } from "vitest";

import { synthesizeDefaultStrategy } from "@/lib/trader/generator/strategy-synthesizer";

describe("strategy synthesizer (M8)", () => {
  it("bumps strategy version for new synthesis", () => {
    const synthesis = synthesizeDefaultStrategy("mean_reversion_v0", "syn-1", "0.1.0");
    expect(synthesis.strategyId).toBe("mean_reversion_v0");
    expect(synthesis.strategyVersion).toBe("0.1.1");
    expect(synthesis.contentDigest.length).toBeGreaterThan(0);
  });
});
