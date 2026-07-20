/**
 * HTR-WP12 — FHV zero-tolerance gap policy.
 */
import { describe, expect, it } from "vitest";

import {
  evaluateGapPolicy,
  FHV_GAP_POLICY_V1,
} from "@/lib/trader/market-data/dataset/fhv-gap-policy";
import { assertIngestBarsIntegrity } from "@/lib/trader/market-data/ingress/bar-integrity-gate";
import {
  makeSyntheticBars,
  makeSyntheticBarsWithGap,
} from "@/tests/unit/helpers/wp11-wp12-fixture";

describe("HTR-WP12 FHV gap policy", () => {
  it("FHV_GAP_POLICY_V1 pins exact zero-tolerance values", () => {
    expect(FHV_GAP_POLICY_V1).toEqual({
      policyId: "FHV_GAP_POLICY_V1",
      maxTotalMissingBars: 0,
      maxSingleGapBars: 0,
      interpolationAllowed: false,
      syntheticBarInsertionAllowed: false,
      silentGapDropAllowed: false,
      crossVenueSubstitutionAllowed: false,
      onAnyGap: "HTR_WP12_DATASET_GAP_POLICY_DECISION_REQUIRED",
    });
  });

  it("evaluateGapPolicy returns PASS for zero-gap histories", () => {
    const bars = makeSyntheticBars(25);
    const integrity = assertIngestBarsIntegrity({
      bars,
      expectedSymbol: "BTC/USDT",
      expectedInterval: "1m",
    });
    expect(integrity.ok).toBe(true);
    if (!integrity.ok) {
      return;
    }

    expect(integrity.gaps).toHaveLength(0);
    expect(evaluateGapPolicy(integrity.gaps)).toBe("PASS");
  });

  it("evaluateGapPolicy returns DECISION_REQUIRED for a single missing bar", () => {
    const bars = makeSyntheticBarsWithGap(1);
    const integrity = assertIngestBarsIntegrity({
      bars,
      expectedSymbol: "BTC/USDT",
      expectedInterval: "1m",
    });
    expect(integrity.ok).toBe(true);
    if (!integrity.ok) {
      return;
    }

    expect(integrity.gaps).toHaveLength(1);
    expect(integrity.gaps[0]?.missingBarCount).toBe(1);
    expect(evaluateGapPolicy(integrity.gaps)).toBe("DECISION_REQUIRED");
  });

  it("evaluateGapPolicy returns DECISION_REQUIRED for an 80-bar gap", () => {
    const bars = makeSyntheticBarsWithGap(80);
    const integrity = assertIngestBarsIntegrity({
      bars,
      expectedSymbol: "BTC/USDT",
      expectedInterval: "1m",
    });
    expect(integrity.ok).toBe(true);
    if (!integrity.ok) {
      return;
    }

    expect(integrity.gaps).toHaveLength(1);
    expect(integrity.gaps[0]?.missingBarCount).toBe(80);
    expect(evaluateGapPolicy(integrity.gaps)).toBe("DECISION_REQUIRED");
  });
});
