import { describe, expect, it } from "vitest";
import { isMiCoreEnabled } from "@/lib/trader/intelligence/mi-core-flag";
import { isHistoricalProfileActive, HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";

describe("trader wp13 no global default", () => {
  it("does not treat env flag as approved profile", () => {
    const prev = process.env.WAIA_MI_CORE_ENABLED;
    process.env.WAIA_MI_CORE_ENABLED = "1";
    expect(isHistoricalProfileActive(undefined)).toBe(false);
    expect(isMiCoreEnabled("1", undefined)).toBe(true);
    expect(isMiCoreEnabled("1", HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1)).toBe(true);
    process.env.WAIA_MI_CORE_ENABLED = prev;
  });
});
