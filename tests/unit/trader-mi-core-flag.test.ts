import { describe, expect, it } from "vitest";

import { isMiCoreEnabled } from "@/lib/trader/intelligence/mi-core-flag";
import { createEmptyHypothesisSessionState } from "@/lib/trader/intelligence/mi-core.types";

describe("mi-core-flag", () => {
  it.each([
    [undefined, false],
    ["", false],
    ["0", false],
    ["false", false],
    ["1", true],
    ["true", true],
    ["yes", true],
    [" YES ", true],
  ] as const)("isMiCoreEnabled(%s) => %s", (raw, expected) => {
    expect(isMiCoreEnabled(raw)).toBe(expected);
  });
});

describe("mi-core types", () => {
  it("createEmptyHypothesisSessionState returns empty session", () => {
    const state = createEmptyHypothesisSessionState();
    expect(state.sustainedCyclesByType).toEqual({});
    expect(state.peakConfidenceByType).toEqual({});
    expect(state.lastActiveHypothesisType).toBeNull();
  });
});
