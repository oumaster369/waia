import { describe, expect, it } from "vitest";

import { resolveForecastOutcomeClass } from "@/lib/trader/intelligence/outcome-resolution/resolve-forecast-outcome";
import { computeForecastOutcomeContentDigest } from "@/lib/trader/intelligence/outcome-resolution/serialize-outcome-resolution";
import { buildWp21ForecastFixture, wp21Bars, wp21Provenance } from "./wp21-test-helpers";

describe("trader wp21 determinism nolookahead", () => {
  it("produces byte-identical digests across replay generations", () => {
    const forecast = buildWp21ForecastFixture();
    const bars = wp21Bars({ count: 90, step: 0.8 });
    const input = {
      context: { organizationId: forecast.organizationId },
      forecast,
      decision: null,
      pitWindow: {
        bars,
        asOf: bars.at(-1)!.barCloseTime,
        evidenceCutoffAt: bars.at(-1)!.barCloseTime,
      },
      provenance: wp21Provenance(),
      codeSha: "wp21",
    };
    const one = resolveForecastOutcomeClass(input);
    const two = resolveForecastOutcomeClass(input);
    expect(one.contentDigest).toBe(two.contentDigest);
    expect(computeForecastOutcomeContentDigest(one)).toBe(one.contentDigest);
  });
});
