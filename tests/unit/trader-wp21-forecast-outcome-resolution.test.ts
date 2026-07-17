import { describe, expect, it } from "vitest";

import {
  evaluateForecastPath,
  classifyExpectedPathDirection,
} from "@/lib/trader/intelligence/outcome-resolution/evaluate-forecast-path";
import {
  isForecastEligibleForResolution,
  resolveForecastOutcomeClass,
} from "@/lib/trader/intelligence/outcome-resolution/resolve-forecast-outcome";
import {
  OutcomeResolutionEarlyResolutionError,
  OutcomeResolutionLookaheadError,
} from "@/lib/trader/intelligence/outcome-resolution/errors";
import { buildWp21ForecastFixture, wp21Bars, wp21Provenance } from "./wp21-test-helpers";

describe("trader wp21 forecast outcome resolution", () => {
  it("does not resolve before eligibleResolutionAt", () => {
    const forecast = buildWp21ForecastFixture();
    expect(isForecastEligibleForResolution(forecast, "2024-01-01T00:30:00.000Z")).toBe(false);
    expect(() =>
      evaluateForecastPath({
        scenarioSetJson: forecast.scenarioSetJson,
        invalidationConditionsJson: "[]",
        issuedAt: forecast.issuedAt,
        eligibleResolutionAt: forecast.targetWindowEndAt,
        evidenceCutoffAt: "2024-01-01T00:30:00.000Z",
        asOf: "2024-01-01T00:30:00.000Z",
        bars: wp21Bars({ count: 30 }),
      }),
    ).toThrow(OutcomeResolutionEarlyResolutionError);
  });

  it("resolves on first eligible PIT closed bar with directional verdict", () => {
    const bars = wp21Bars({ count: 90, step: 1 });
    const result = evaluateForecastPath({
      scenarioSetJson: JSON.stringify({ expected_path: "continuation_higher" }),
      invalidationConditionsJson: "[]",
      issuedAt: "2024-01-01T00:00:00.000Z",
      eligibleResolutionAt: "2024-01-01T01:00:00.000Z",
      evidenceCutoffAt: bars.at(-1)!.barCloseTime,
      asOf: bars.at(-1)!.barCloseTime,
      bars,
    });
    expect(result.outcomeClass).toBe("RESOLVED");
    expect(result.outcomeVerdict).toBe("CORRECT");
  });

  it("rejects future bars (no lookahead)", () => {
    const bars = wp21Bars({ count: 5 });
    expect(() =>
      evaluateForecastPath({
        scenarioSetJson: JSON.stringify({ expected_path: "continuation_higher" }),
        invalidationConditionsJson: "[]",
        issuedAt: bars[0]!.barOpenTime,
        eligibleResolutionAt: bars.at(-1)!.barCloseTime,
        evidenceCutoffAt: bars[0]!.barCloseTime,
        asOf: bars.at(-1)!.barCloseTime,
        bars,
      }),
    ).toThrow(OutcomeResolutionLookaheadError);
  });

  it("derives deterministic forecast outcome digest", () => {
    const forecast = buildWp21ForecastFixture();
    const bars = wp21Bars({ count: 90, step: 1 });
    const one = resolveForecastOutcomeClass({
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
    });
    const two = resolveForecastOutcomeClass({
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
    });
    expect(one).toEqual(two);
    expect(one.contentDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("classifies bullish expected paths", () => {
    expect(classifyExpectedPathDirection("continuation_higher")).toBe("BULLISH");
    expect(classifyExpectedPathDirection("no_clear_path")).toBe("NEUTRAL");
  });
});
