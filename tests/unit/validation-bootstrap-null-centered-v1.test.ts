import { describe, expect, it } from "vitest";

import {
  nullCenterPairedDifferentials,
  observedNullCenteredBootstrapStatistic,
  VALIDATION_BOOTSTRAP_B,
  VALIDATION_BOOTSTRAP_MONTE_CARLO_DENOMINATOR,
  validationBootstrapPValueV1,
} from "@/lib/trader/research/benchmark/validation-bootstrap-v1";
import { computeTrialIdentityDigestV2 } from "@/lib/trader/research/benchmark/trial-identity-v2";

const TRIAL_DIGEST = computeTrialIdentityDigestV2({
  scoringContractVersion: "multiclass-log-score/v1",
  evaluationPartitionReceiptDigestHex: "a".repeat(64),
  venue: "htx",
  market: "spot",
  symbol: "BTCUSDT",
  primaryHorizonMinutes: 30,
  modelTransformVersion: "rv-state-conditional-empirical-joint/v1",
  challengerPackageContentDigestHex: "b".repeat(64),
  baselineId: "climatology/v1",
  metricId: "terminal-multiclass-log-score/v1",
  commonAnchorSetDigestHex: "c".repeat(64),
  purgeDurationMinutes: 30,
  embargoDurationMinutes: 30,
  comparisonFamilyId: "mandatory-baseline-family/v1",
});

describe("DEE-531 Human-ratified null-centered bootstrap admission", () => {
  it("D: null-centered series mean is exactly zero", () => {
    const differentials = [0.2, -0.1, 0.05, 0.15, -0.3];
    const { centered, n } = nullCenterPairedDifferentials(differentials);
    const centeredMean = centered.reduce((acc, value) => acc + value, 0) / n;
    expect(centeredMean).toBeCloseTo(0, 14);
  });

  it("G: constant positive differential yields extreme_count=0 and p_raw=1/10,001", () => {
    const differentials = Array.from({ length: 12 }, () => 0.25);
    const result = validationBootstrapPValueV1({
      differentials,
      trialIdentityDigest32: TRIAL_DIGEST,
    });
    expect(result.extremeCount).toBe(0);
    expect(result.pRaw).toBe(1 / VALIDATION_BOOTSTRAP_MONTE_CARLO_DENOMINATOR);
    expect(result.pRaw).toBeGreaterThan(0);
  });

  it("E: larger positive improvement yields smaller raw p-value", () => {
    const weak = validationBootstrapPValueV1({
      differentials: [0.002, 0.001, -0.001, 0.0015, 0.0, -0.0005],
      trialIdentityDigest32: TRIAL_DIGEST,
    });
    const strong = validationBootstrapPValueV1({
      differentials: [0.35, 0.32, 0.38, 0.33, 0.36, 0.31, 0.37, 0.34, 0.39, 0.3],
      trialIdentityDigest32: TRIAL_DIGEST,
    });
    expect(strong.dBar).toBeGreaterThan(weak.dBar);
    expect(weak.pRaw).toBeGreaterThan(0.01);
    expect(strong.pRaw).toBeLessThan(weak.pRaw);
  }, 180_000);

  it("B: zero-mean differential corpus does not produce spurious qualification p-values", () => {
    const differentials = [0.1, -0.1, 0.05, -0.05, 0.0, 0.0];
    const result = validationBootstrapPValueV1({
      differentials,
      trialIdentityDigest32: TRIAL_DIGEST,
    });
    expect(result.dBar).toBe(0);
    expect(result.tObs).toBe(0);
    expect(result.pRaw).toBeGreaterThan(0.05);
  }, 180_000);

  it("C: negative mean yields d_bar <= 0 regardless of p artifact", () => {
    const differentials = [-0.2, -0.15, -0.1, -0.05, -0.12];
    const result = validationBootstrapPValueV1({
      differentials,
      trialIdentityDigest32: TRIAL_DIGEST,
    });
    expect(result.dBar).toBeLessThanOrEqual(0);
    expect(observedNullCenteredBootstrapStatistic(differentials)).toBeLessThanOrEqual(0);
  }, 180_000);

  it("F: exceedance comparator uses T*_b >= T_obs", () => {
    const differentials = [0.04, 0.03, 0.02, 0.01];
    const result = validationBootstrapPValueV1({
      differentials,
      trialIdentityDigest32: TRIAL_DIGEST,
    });
    expect(result.extremeCount).toBeGreaterThanOrEqual(0);
    expect(result.extremeCount).toBeLessThanOrEqual(VALIDATION_BOOTSTRAP_B);
    expect(result.pRaw).toBe(
      (result.extremeCount + 1) / VALIDATION_BOOTSTRAP_MONTE_CARLO_DENOMINATOR,
    );
  }, 180_000);

  it("K: identical inputs yield byte-identical raw p-values", () => {
    const differentials = [0.08, 0.06, 0.04, 0.02, 0.05, 0.03];
    const one = validationBootstrapPValueV1({
      differentials,
      trialIdentityDigest32: TRIAL_DIGEST,
    });
    const two = validationBootstrapPValueV1({
      differentials,
      trialIdentityDigest32: TRIAL_DIGEST,
    });
    expect(one.pRaw).toBe(two.pRaw);
    expect(one.extremeCount).toBe(two.extremeCount);
    expect(one.tObs).toBe(two.tObs);
  }, 180_000);
});
