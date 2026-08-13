import { describe, expect, it } from "vitest";

import {
  evaluateA3ExactRationalAggregateMath,
  assertA3ExactRationalAggregateMath,
  formatA3ExactRationalDisplay,
} from "@/lib/trader/intelligence/forecast-v2/a3-storage-rational-arithmetic-aggregate-v1";
import {
  FORECAST_V2_MAX_BYTES_PER_COMPLETE_BUNDLE,
  FORECAST_V2_MAX_TOTAL_PROJECTED_BYTES,
  FORECAST_V2_OFFICIAL_BUNDLE_COUNT,
} from "@/lib/trader/intelligence/forecast-v2/storage-scale-projection";

describe("A3 exact rational aggregate math", () => {
  it("uses exact rational arithmetic without ceil substitution", () => {
    const b0 = 1_000_000;
    const packageFixed = 50_000_000;
    const b1 = b0 + packageFixed + 200_001;
    const math = evaluateA3ExactRationalAggregateMath({
      b0Bytes: b0,
      b1Bytes: b1,
      packageFixedContributionBytes: packageFixed,
      enumeratedFixedV2OtherBytes: 0,
      nBundles: 200_000,
    });
    expect(math.bytesPerCompleteBundleNumerator).toBe("200001");
    expect(math.bytesPerCompleteBundleDenominator).toBe("200000");
    expect(Math.ceil((b1 - b0 - packageFixed) / 200_000)).toBe(2);
    expect(math.passesBytesPerBundleThreshold).toBe(true);
    expect(Number(math.bytesPerCompleteBundleNumerator)).toBeLessThan(
      4096 * Number(math.bytesPerCompleteBundleDenominator),
    );
  });

  it("passes exact 4096 threshold boundary via cross multiplication", () => {
    const n = 200_000n;
    const packageFixed = 50_000_000;
    const b0 = 1_000_000;
    const numerator = Number(4096n * n);
    const math = evaluateA3ExactRationalAggregateMath({
      b0Bytes: b0,
      b1Bytes: b0 + packageFixed + numerator,
      packageFixedContributionBytes: packageFixed,
      enumeratedFixedV2OtherBytes: 0,
      nBundles: Number(n),
    });
    expect(math.passesBytesPerBundleThreshold).toBe(true);
  });

  it("fails one byte above exact 4096 numerator boundary", () => {
    const n = 200_000n;
    const packageFixed = 50_000_000;
    const b0 = 1_000_000;
    const numerator = Number(4096n * n + 1n);
    const math = evaluateA3ExactRationalAggregateMath({
      b0Bytes: b0,
      b1Bytes: b0 + packageFixed + numerator,
      packageFixedContributionBytes: packageFixed,
      enumeratedFixedV2OtherBytes: 0,
      nBundles: Number(n),
    });
    expect(math.passesBytesPerBundleThreshold).toBe(false);
  });

  it("passes exact 100 GiB projection boundary", () => {
    const n = 200_000n;
    const official = BigInt(FORECAST_V2_OFFICIAL_BUNDLE_COUNT);
    const packageFixed = 50_000_000n;
    const maxTotal = BigInt(FORECAST_V2_MAX_TOTAL_PROJECTED_BYTES);
    const bundleNumerator = (maxTotal * n - packageFixed * n) / official;
    const math = evaluateA3ExactRationalAggregateMath({
      b0Bytes: 1_000_000,
      b1Bytes: Number(1_000_000n + packageFixed + bundleNumerator),
      packageFixedContributionBytes: Number(packageFixed),
      enumeratedFixedV2OtherBytes: 0,
      nBundles: Number(n),
      officialBundleCount: Number(official),
    });
    expect(math.passesTotalProjectedThreshold).toBe(true);
  });

  it("fails above 100 GiB by smallest rational increment", () => {
    const n = 200_000n;
    const official = BigInt(FORECAST_V2_OFFICIAL_BUNDLE_COUNT);
    const packageFixed = 50_000_000n;
    const maxTotal = BigInt(FORECAST_V2_MAX_TOTAL_PROJECTED_BYTES);
    const bundleNumerator = (maxTotal * n - packageFixed * n) / official + 1n;
    const math = evaluateA3ExactRationalAggregateMath({
      b0Bytes: 1_000_000,
      b1Bytes: Number(1_000_000n + packageFixed + bundleNumerator),
      packageFixedContributionBytes: Number(packageFixed),
      enumeratedFixedV2OtherBytes: 0,
      nBundles: Number(n),
      officialBundleCount: Number(official),
    });
    expect(math.passesTotalProjectedThreshold).toBe(false);
  });

  it("rejects non-positive bundle numerator", () => {
    const math = evaluateA3ExactRationalAggregateMath({
      b0Bytes: 100,
      b1Bytes: 100,
      packageFixedContributionBytes: 0,
      enumeratedFixedV2OtherBytes: 0,
      nBundles: 200_000,
    });
    expect(math.passesNumeratorPositive).toBe(false);
  });
});

describe("formatA3ExactRationalDisplay", () => {
  it("A3 bytes/bundle known answer (reduced)", () => {
    expect(formatA3ExactRationalDisplay(2271744n, 625n)).toBe("3634.7904");
  });

  it("A3 bytes/bundle known answer (unreduced) matches reduced", () => {
    expect(formatA3ExactRationalDisplay(726958080n, 200000n)).toBe("3634.7904");
    expect(formatA3ExactRationalDisplay(726958080n, 200000n)).toBe(
      formatA3ExactRationalDisplay(2271744n, 625n),
    );
  });

  it("A3 TOTAL_PROJECTED known answer", () => {
    expect(formatA3ExactRationalDisplay(5738348240896n, 125n)).toBe("45906785927.168");
    expect(formatA3ExactRationalDisplay(9181357185433600n, 200000n)).toBe("45906785927.168");
  });

  it("leading-zero fractional digits", () => {
    expect(formatA3ExactRationalDisplay(1n, 2n)).toBe("0.5");
    expect(formatA3ExactRationalDisplay(1n, 4n)).toBe("0.25");
    expect(formatA3ExactRationalDisplay(1n, 8n)).toBe("0.125");
    expect(formatA3ExactRationalDisplay(1n, 20n)).toBe("0.05");
    expect(formatA3ExactRationalDisplay(1n, 1000n)).toBe("0.001");
    expect(formatA3ExactRationalDisplay(1001n, 1000n)).toBe("1.001");
  });

  it("integer exact values and zero", () => {
    expect(formatA3ExactRationalDisplay(0n, 200000n)).toBe("0");
    expect(formatA3ExactRationalDisplay(4096n, 1n)).toBe("4096");
    expect(formatA3ExactRationalDisplay(819200000n, 200000n)).toBe("4096");
  });

  it("signed value behavior", () => {
    expect(formatA3ExactRationalDisplay(-2271744n, 625n)).toBe("-3634.7904");
    expect(formatA3ExactRationalDisplay(2271744n, -625n)).toBe("-3634.7904");
    expect(formatA3ExactRationalDisplay(-2271744n, -625n)).toBe("3634.7904");
  });

  it("fails closed on non-terminating expansion", () => {
    expect(() => formatA3ExactRationalDisplay(1n, 3n)).toThrow(/non-terminating/);
  });

  it("authoritative A3 dry math emits corrected displays; BigInt predicates unchanged", () => {
    const math = evaluateA3ExactRationalAggregateMath({
      b0Bytes: 286720,
      b1Bytes: 741457920,
      packageFixedContributionBytes: 14213120,
      enumeratedFixedV2OtherBytes: 0,
      nBundles: 200000,
    });
    expect(math.bundleNumeratorBytes).toBe("726958080");
    expect(math.bytesPerCompleteBundleDisplay).toBe("3634.7904");
    expect(math.totalProjectedDisplayBytes).toBe("45906785927.168");
    expect(math.passesBytesPerBundleThreshold).toBe(true);
    expect(math.passesTotalProjectedThreshold).toBe(true);
    expect(math.failureReasons).toEqual([]);
    assertA3ExactRationalAggregateMath(math);
    expect(
      BigInt(math.bundleNumeratorBytes) <=
        BigInt(FORECAST_V2_MAX_BYTES_PER_COMPLETE_BUNDLE) * 200000n,
    ).toBe(true);
    expect(
      BigInt(math.totalProjectedNumerator) <=
        BigInt(FORECAST_V2_MAX_TOTAL_PROJECTED_BYTES) * BigInt(math.totalProjectedDenominator),
    ).toBe(true);
  });
});
