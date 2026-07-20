import type { TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1_DATA } from "@/lib/trader/intelligence/matrix/timeframe-evidence-lane-authority-matrix-v1-data";

export type MatrixId = "TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1";

export type TimeframeEvidenceLaneAuthorityMatrix =
  typeof TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1_DATA;

export type EvidenceLane = TimeframeEvidenceLaneAuthorityMatrix["lanes"][number];
export type TimeframeAuthority = TimeframeEvidenceLaneAuthorityMatrix["timeframeAuthority"][number];
