/** Official issuance bundle count for primary horizons (plan §1.7). */
export const FORECAST_V2_OFFICIAL_BUNDLE_COUNT = 12_625_920;

/** Maximum allowed bytes per complete bundle (plan §5 PHASE-1). */
export const FORECAST_V2_MAX_BYTES_PER_COMPLETE_BUNDLE = 4096;

/** Maximum projected immutable evidence budget (100 GiB). */
export const FORECAST_V2_MAX_TOTAL_PROJECTED_BYTES = 100 * 1024 * 1024 * 1024;

/** K_max replica artifact row count per package. */
export const FORECAST_V2_K_MAX = 50;

/** Maximum replica artifact payload bytes (trigger-enforced). */
export const FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES = 65_536;

/** Worst-case replica payload sum per package (plan §5 PHASE-2). */
export const FORECAST_V2_PACKAGE_REPLICA_PAYLOAD_BYTES =
  FORECAST_V2_K_MAX * FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES;

/** Proportional row count per complete bundle (plan §5 PHASE-1). */
export const FORECAST_V2_PROPORTIONAL_ROWS_PER_BUNDLE = 14;

export type ForecastV2StorageScaleReceiptV1 = {
  schemaVersion: "forecast-v2-storage-scale-receipt/v1";
  bytesPerCompleteBundle: number;
  packageFixedContributionBytes: number;
  enumeratedFixedV2OtherBytes: number;
  totalProjectedBytes: number;
  officialBundleCount: number;
  proportionalRowsPerBundle: number;
  pass: boolean;
  failureReasons: string[];
};

export function computeForecastV2TotalProjectedBytes(input: {
  bytesPerCompleteBundle: number;
  packageFixedContributionBytes: number;
  enumeratedFixedV2OtherBytes?: number;
  officialBundleCount?: number;
}): number {
  const bundleCount = input.officialBundleCount ?? FORECAST_V2_OFFICIAL_BUNDLE_COUNT;
  const fixedOther = input.enumeratedFixedV2OtherBytes ?? 0;
  return (
    bundleCount * input.bytesPerCompleteBundle + input.packageFixedContributionBytes + fixedOther
  );
}

export function evaluateForecastV2StorageScaleReceipt(input: {
  bytesPerCompleteBundle: number;
  packageFixedContributionBytes: number;
  enumeratedFixedV2OtherBytes?: number;
  officialBundleCount?: number;
}): ForecastV2StorageScaleReceiptV1 {
  const totalProjectedBytes = computeForecastV2TotalProjectedBytes(input);
  const failureReasons: string[] = [];

  if (input.bytesPerCompleteBundle > FORECAST_V2_MAX_BYTES_PER_COMPLETE_BUNDLE) {
    failureReasons.push(
      `bytes_per_complete_bundle ${input.bytesPerCompleteBundle} exceeds ${FORECAST_V2_MAX_BYTES_PER_COMPLETE_BUNDLE}`,
    );
  }
  if (totalProjectedBytes > FORECAST_V2_MAX_TOTAL_PROJECTED_BYTES) {
    failureReasons.push(
      `TOTAL_PROJECTED ${totalProjectedBytes} exceeds ${FORECAST_V2_MAX_TOTAL_PROJECTED_BYTES}`,
    );
  }

  return {
    schemaVersion: "forecast-v2-storage-scale-receipt/v1",
    bytesPerCompleteBundle: input.bytesPerCompleteBundle,
    packageFixedContributionBytes: input.packageFixedContributionBytes,
    enumeratedFixedV2OtherBytes: input.enumeratedFixedV2OtherBytes ?? 0,
    totalProjectedBytes,
    officialBundleCount: input.officialBundleCount ?? FORECAST_V2_OFFICIAL_BUNDLE_COUNT,
    proportionalRowsPerBundle: FORECAST_V2_PROPORTIONAL_ROWS_PER_BUNDLE,
    pass: failureReasons.length === 0,
    failureReasons,
  };
}
