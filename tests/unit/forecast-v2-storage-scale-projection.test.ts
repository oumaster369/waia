import { describe, expect, it } from "vitest";

import {
  evaluateForecastV2StorageScaleReceipt,
  FORECAST_V2_MAX_BYTES_PER_COMPLETE_BUNDLE,
  FORECAST_V2_MAX_TOTAL_PROJECTED_BYTES,
  FORECAST_V2_OFFICIAL_BUNDLE_COUNT,
  FORECAST_V2_PACKAGE_REPLICA_PAYLOAD_BYTES,
  FORECAST_V2_PROPORTIONAL_ROWS_PER_BUNDLE,
} from "@/lib/trader/intelligence/forecast-v2/storage-scale-projection";

describe("forecast-v2 storage-scale projection (DEE-527 §5)", () => {
  it("uses 14 proportional rows per complete bundle contract", () => {
    expect(FORECAST_V2_PROPORTIONAL_ROWS_PER_BUNDLE).toBe(14);
  });

  it("PASS when measured bytes_per_complete_bundle and package fixed stay within budget", () => {
    const receipt = evaluateForecastV2StorageScaleReceipt({
      bytesPerCompleteBundle: 2048,
      packageFixedContributionBytes: FORECAST_V2_PACKAGE_REPLICA_PAYLOAD_BYTES * 4,
      enumeratedFixedV2OtherBytes: 64 * 1024 * 1024,
    });
    expect(receipt.pass).toBe(true);
    expect(receipt.totalProjectedBytes).toBeLessThanOrEqual(FORECAST_V2_MAX_TOTAL_PROJECTED_BYTES);
    expect(receipt.officialBundleCount).toBe(FORECAST_V2_OFFICIAL_BUNDLE_COUNT);
  });

  it("FAIL when bytes_per_complete_bundle exceeds 4096", () => {
    const receipt = evaluateForecastV2StorageScaleReceipt({
      bytesPerCompleteBundle: FORECAST_V2_MAX_BYTES_PER_COMPLETE_BUNDLE + 1,
      packageFixedContributionBytes: 0,
    });
    expect(receipt.pass).toBe(false);
    expect(receipt.failureReasons.some((r) => r.includes("bytes_per_complete_bundle"))).toBe(true);
  });

  it("FAIL when TOTAL_PROJECTED exceeds 100 GiB", () => {
    const receipt = evaluateForecastV2StorageScaleReceipt({
      bytesPerCompleteBundle: FORECAST_V2_MAX_BYTES_PER_COMPLETE_BUNDLE,
      packageFixedContributionBytes: FORECAST_V2_MAX_TOTAL_PROJECTED_BYTES,
    });
    expect(receipt.pass).toBe(false);
    expect(receipt.failureReasons.some((r) => r.includes("TOTAL_PROJECTED"))).toBe(true);
  });
});
