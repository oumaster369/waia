import { TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1_DATA } from "@/lib/trader/intelligence/matrix/timeframe-evidence-lane-authority-matrix-v1-data";
import type {
  EvidenceLane,
  TimeframeAuthority,
  TimeframeEvidenceLaneAuthorityMatrix,
} from "@/lib/trader/intelligence/matrix/timeframe-evidence-lane-authority-matrix.types";
import {
  canonicalizeMatrix,
  computeMatrixDigest,
} from "@/lib/trader/intelligence/matrix/serialize-matrix";

export type { EvidenceLane, TimeframeAuthority, TimeframeEvidenceLaneAuthorityMatrix };
export { canonicalizeMatrix, computeMatrixDigest };

const STAGING_MATRIX =
  TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1_DATA as unknown as TimeframeEvidenceLaneAuthorityMatrix;

export const TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1: TimeframeEvidenceLaneAuthorityMatrix =
  canonicalizeMatrix(STAGING_MATRIX);

export const TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1_DIGEST = computeMatrixDigest(
  TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1,
);

export function assertTimeframeLaneAuthority(timeframe: string): TimeframeAuthority | null {
  return (
    TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1.timeframeAuthority.find(
      (entry) => entry.timeframe === timeframe,
    ) ?? null
  );
}

export function assertNoProviderAccessFromTimeframe(_timeframe: string): void {
  const invariant = TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1.hardInvariants.find((item) =>
    item.includes("no timeframe directly calls a provider"),
  );
  if (!invariant) {
    throw new Error("WP13_PROVIDER_ACCESS_FROM_TIMEFRAME: matrix invariant missing");
  }
}

export function countMatrixLanes(
  matrix: TimeframeEvidenceLaneAuthorityMatrix = TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1,
) {
  const qualifiedPrimaryPriceLanes = matrix.lanes.filter(
    (lane) => lane.historicalAvailability === "AVAILABLE_ON_REAL_DATASET_ACQUISITION",
  ).length;
  const unavailableHistoricalSidecarLanes = matrix.lanes.filter(
    (lane) => lane.historicalAvailability === "UNAVAILABLE",
  ).length;
  return {
    laneCount: matrix.lanes.length,
    qualifiedPrimaryPriceLanes,
    unavailableHistoricalSidecarLanes,
  };
}
