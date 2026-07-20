import type { GapRecord } from "@/lib/trader/market-data/ingress/bar-integrity-gate";

export const FHV_GAP_POLICY_V1 = {
  policyId: "FHV_GAP_POLICY_V1",
  maxTotalMissingBars: 0,
  maxSingleGapBars: 0,
  interpolationAllowed: false,
  syntheticBarInsertionAllowed: false,
  silentGapDropAllowed: false,
  crossVenueSubstitutionAllowed: false,
  onAnyGap: "HTR_WP12_DATASET_GAP_POLICY_DECISION_REQUIRED",
} as const;

export type FhvGapPolicyV1 = typeof FHV_GAP_POLICY_V1;

export type GapPolicyResult = "PASS" | "DECISION_REQUIRED";

/** Evaluate recorded gaps against the zero-tolerance FHV gap policy (HTR-WP12). */
export function evaluateGapPolicy(gaps: readonly GapRecord[]): GapPolicyResult {
  if (gaps.length === 0) {
    return "PASS";
  }

  const totalMissingBars = gaps.reduce((sum, gap) => sum + gap.missingBarCount, 0);
  const maxSingleGapBars = gaps.reduce((max, gap) => Math.max(max, gap.missingBarCount), 0);

  if (totalMissingBars > FHV_GAP_POLICY_V1.maxTotalMissingBars) {
    return "DECISION_REQUIRED";
  }

  if (maxSingleGapBars > FHV_GAP_POLICY_V1.maxSingleGapBars) {
    return "DECISION_REQUIRED";
  }

  return "PASS";
}
