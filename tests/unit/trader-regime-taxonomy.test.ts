import { describe, expect, it } from "vitest";

import {
  buildResearchRegimeCoverage,
  CANONICAL_RESEARCH_REGIME_LABELS,
  isCanonicalResearchRegimeLabel,
} from "@/lib/trader/research/regime-taxonomy";
import { hasSufficientResearchRegimeCoverage } from "@/lib/trader/research/serialize-research-evidence-export";

describe("research regime taxonomy (RI-INTEGRATION-1)", () => {
  it("uses CDE regime labels exclusively", () => {
    expect(CANONICAL_RESEARCH_REGIME_LABELS).toEqual([
      "TREND_BULL",
      "TREND_BEAR",
      "RANGE",
      "CHOP",
      "STRESS",
    ]);
    expect(isCanonicalResearchRegimeLabel("trend_up")).toBe(false);
    expect(isCanonicalResearchRegimeLabel("RANGE")).toBe(true);
  });

  it("buildResearchRegimeCoverage marks ADR-0010 multi-regime requirement", () => {
    const insufficient = buildResearchRegimeCoverage(["RANGE"]);
    expect(insufficient.satisfiesRequirement).toBe(false);
    expect(hasSufficientResearchRegimeCoverage(insufficient)).toBe(false);

    const sufficient = buildResearchRegimeCoverage(["RANGE", "TREND_BEAR"]);
    expect(sufficient.satisfiesRequirement).toBe(true);
    expect(hasSufficientResearchRegimeCoverage(sufficient)).toBe(true);
  });
});
