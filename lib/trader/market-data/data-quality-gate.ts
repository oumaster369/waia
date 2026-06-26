import { FEATURE_ENGINE_QUALITY_THRESHOLD } from "@/lib/trader/intelligence/feature-engine-v0";
import type { FeatureSnapshot } from "@/lib/trader/intelligence/types";

export const DATA_QUALITY_HALT_REASON = "DATA_QUALITY_FAIL_CLOSED" as const;
export const INGESTION_HALT_REASON = "INGESTION_FAIL_CLOSED" as const;

export type DataQualityGateResult = {
  halt: boolean;
  reasonCode: typeof DATA_QUALITY_HALT_REASON | typeof INGESTION_HALT_REASON | null;
  dataQualityScore: number;
  threshold: number;
};

/**
 * Fail-closed data-quality gate (DEE-198). Halts the pipeline when quality is below threshold.
 */
export function evaluateDataQualityGate(features: FeatureSnapshot): DataQualityGateResult {
  const threshold = FEATURE_ENGINE_QUALITY_THRESHOLD;
  if (features.dataQualityScore < threshold) {
    return {
      halt: true,
      reasonCode: DATA_QUALITY_HALT_REASON,
      dataQualityScore: features.dataQualityScore,
      threshold,
    };
  }
  return {
    halt: false,
    reasonCode: null,
    dataQualityScore: features.dataQualityScore,
    threshold,
  };
}

export function evaluateIngestionFailureGate(): DataQualityGateResult {
  return {
    halt: true,
    reasonCode: INGESTION_HALT_REASON,
    dataQualityScore: 0,
    threshold: FEATURE_ENGINE_QUALITY_THRESHOLD,
  };
}
