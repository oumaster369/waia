import { describe, expect, it } from "vitest";

import {
  erfCody715V1,
  normalCdfCody715V1,
} from "@/lib/trader/research/benchmark/cdf-erf-cody715-v1";
import { betaincLentzV1 } from "@/lib/trader/research/benchmark/betainc-lentz-v1";
import {
  STUDENT_T5_KNOWN_ANSWERS,
  studentT5CdfBetaincV1,
} from "@/lib/trader/research/benchmark/student-t5-cdf-betainc-v1";
import { holmFwerV1 } from "@/lib/trader/research/benchmark/holm-fwer-v1";
import { type7QuantileV1 } from "@/lib/trader/research/benchmark/type7-quantile-v1";
import {
  deriveValidationBootstrapRoot,
  validationBootstrapResampleV1,
} from "@/lib/trader/research/benchmark/validation-bootstrap-v1";
import { computeTrialIdentityDigestV2 } from "@/lib/trader/research/benchmark/trial-identity-v2";
import { MANDATORY_BASELINES_V1 } from "@/lib/trader/research/benchmark/baseline-models-v1";

describe("DEE-531 research harness — cdf-erf-cody715/v1", () => {
  it("erf(0)=0 and erf branches are stable at thresholds", () => {
    expect(erfCody715V1(0)).toBe(0);
    expect(erfCody715V1(0.46875)).toBeGreaterThan(0.4);
    expect(erfCody715V1(4)).toBeCloseTo(1, 7);
    expect(erfCody715V1(-4)).toBeCloseTo(-1, 7);
  });

  it("Phi(0)=0.5", () => {
    expect(normalCdfCody715V1(0)).toBe(0.5);
  });
});

describe("DEE-531 research harness — student-t5-cdf-betainc/v1", () => {
  it.each(STUDENT_T5_KNOWN_ANSWERS)("F($z) matches frozen table", ({ z, f }) => {
    expect(studentT5CdfBetaincV1(z, 1)).toBeCloseTo(f, 12);
  });

  it("symmetry F(z)+F(-z)=1", () => {
    for (const z of [0.5, 1, 2, 5]) {
      const sum = studentT5CdfBetaincV1(z, 1) + studentT5CdfBetaincV1(-z, 1);
      expect(sum).toBeCloseTo(1, 14);
    }
  });
});

describe("DEE-531 research harness — betainc-lentz/v1", () => {
  it("returns 0 and 1 at endpoints", () => {
    expect(betaincLentzV1(2.5, 0.5, 0)).toBe(0);
    expect(betaincLentzV1(2.5, 0.5, 1)).toBe(1);
  });
});

describe("DEE-531 research harness — holm-fwer/v1", () => {
  it("known-answer step-down rejection", () => {
    const results = holmFwerV1(
      [
        { comparisonId: "a", pValue: 0.001 },
        { comparisonId: "b", pValue: 0.04 },
        { comparisonId: "c", pValue: 0.2 },
      ],
      0.05,
    );
    expect(results.find((r) => r.comparisonId === "a")?.rejected).toBe(true);
    expect(results.find((r) => r.comparisonId === "b")?.rejected).toBe(false);
    expect(results.find((r) => r.comparisonId === "c")?.rejected).toBe(false);
  });
});

describe("DEE-531 research harness — type-7 quantile", () => {
  it("median of symmetric sample", () => {
    const sorted = [-2, -1, 0, 1, 2];
    expect(type7QuantileV1(sorted, 0.5)).toBe(0);
  });
});

describe("DEE-531 research harness — VALBOOT1", () => {
  it("deterministic resample for fixed trial identity", () => {
    const trialDigest = computeTrialIdentityDigestV2({
      scoringContractVersion: "energy-mc/v1",
      evaluationPartitionReceiptDigestHex: "a".repeat(64),
      venue: "htx",
      market: "spot",
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 30,
      modelTransformVersion: "rv-state-conditional-empirical-joint/v1",
      challengerPackageContentDigestHex: "b".repeat(64),
      baselineId: "climatology/v1",
      metricId: "log-score/v1",
      commonAnchorSetDigestHex: "c".repeat(64),
      purgeDurationMinutes: 30,
      embargoDurationMinutes: 30,
      comparisonFamilyId: "family-1",
    });
    const root = deriveValidationBootstrapRoot(trialDigest);
    const source = [1, 2, 3, 4, 5];
    const first = validationBootstrapResampleV1({
      source,
      validationBootstrapRoot: root,
      resampleOrdinal: 0,
    });
    const second = validationBootstrapResampleV1({
      source,
      validationBootstrapRoot: root,
      resampleOrdinal: 0,
    });
    expect(first.indexVector).toEqual(second.indexVector);
  });
});

describe("DEE-531 research harness — baselines", () => {
  it("exports five mandatory baselines", () => {
    expect(MANDATORY_BASELINES_V1).toHaveLength(5);
  });
});

describe("DEE-531 research harness — trial identity acyclicity", () => {
  it("distinct comparison_family_id yields distinct bootstrap root", () => {
    const base = {
      scoringContractVersion: "energy-mc/v1",
      evaluationPartitionReceiptDigestHex: "d".repeat(64),
      venue: "htx",
      market: "spot",
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 30,
      modelTransformVersion: "rv-state-conditional-empirical-joint/v1",
      challengerPackageContentDigestHex: "e".repeat(64),
      baselineId: "climatology/v1",
      metricId: "log-score/v1",
      commonAnchorSetDigestHex: "f".repeat(64),
      purgeDurationMinutes: 30,
      embargoDurationMinutes: 30,
    };
    const d1 = computeTrialIdentityDigestV2({ ...base, comparisonFamilyId: "family-a" });
    const d2 = computeTrialIdentityDigestV2({ ...base, comparisonFamilyId: "family-b" });
    expect(d1.equals(d2)).toBe(false);
    expect(deriveValidationBootstrapRoot(d1).equals(deriveValidationBootstrapRoot(d2))).toBe(false);
  });
});
