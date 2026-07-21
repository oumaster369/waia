import type { FhvHoldoutStatusV1 } from "@/lib/trader/observability/fhv-operator-status-v1.types";

export const FHV_HOLDOUT_GATE_CLOSED_STATUS: FhvHoldoutStatusV1 = {
  holdoutState: "SEALED_NOT_ACCESSED",
  holdoutGate: "CLOSED",
  holdoutDatasetDigest: "",
  holdoutAccessAttempts: 0,
  blindHoldoutStatus: "SEALED_NOT_ACCESSED",
  holdoutAccess: "PROHIBITED_UNTIL_OPERATOR_PROCEDURE",
};

const PROHIBITED_HOLDOUT_KEYS = [
  "holdoutPnl",
  "holdoutEquity",
  "holdoutTrades",
  "holdoutDecisions",
  "holdoutHypotheses",
  "holdoutCandidateRankings",
  "holdoutComparisonResults",
  "blindHoldoutPnl",
  "blindHoldoutEquity",
] as const;

export function buildClosedHoldoutStatus(input: {
  holdoutDatasetDigest: string;
  holdoutAccessAttempts?: number;
}): FhvHoldoutStatusV1 {
  return {
    ...FHV_HOLDOUT_GATE_CLOSED_STATUS,
    holdoutDatasetDigest: input.holdoutDatasetDigest,
    holdoutAccessAttempts: input.holdoutAccessAttempts ?? 0,
  };
}

export function redactHoldoutPayload<T extends Record<string, unknown>>(
  payload: T,
  gateOpen: boolean,
): T {
  if (gateOpen) {
    return payload;
  }
  const clone = { ...payload };
  for (const key of PROHIBITED_HOLDOUT_KEYS) {
    if (key in clone) {
      delete clone[key];
    }
  }
  if ("holdout" in clone && typeof clone.holdout === "object" && clone.holdout !== null) {
    (clone as Record<string, unknown>).holdout = buildClosedHoldoutStatus({
      holdoutDatasetDigest:
        typeof (clone.holdout as Record<string, unknown>).holdoutDatasetDigest === "string"
          ? ((clone.holdout as Record<string, unknown>).holdoutDatasetDigest as string)
          : "",
    });
  }
  return clone;
}

export function assertHoldoutGateClosedExposure(payload: Record<string, unknown>): void {
  for (const key of PROHIBITED_HOLDOUT_KEYS) {
    if (key in payload && payload[key] !== undefined && payload[key] !== null) {
      throw new Error(`FHV_HOLDOUT_REDACTION_VIOLATION:${key}`);
    }
  }
}
