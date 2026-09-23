import type { Attribution } from "@/lib/trader/admin-console/attribution/trade-attribution";
import { ADMIN_REASON } from "@/lib/trader/admin-console/reason-codes";

export const GUARDIAN_FRESH_MS = 15 * 60 * 1000;

export type PositionGuardianAssessment = {
  assessmentId: string;
  assessedAt: string;
  recommendation: string;
  openPositionSufficiency: string;
  newOpportunitySufficiency: string;
};

export function presentGuardian(assessment: PositionGuardianAssessment | null, now: Date) {
  if (!assessment) {
    return {
      freshness: "stale" as const,
      reason: ADMIN_REASON.guardianAssessmentMissing,
      assessmentId: null,
      assessedAt: null,
      recommendation: null,
      openPositionSufficiency: null,
      newOpportunitySufficiency: null,
    };
  }
  const assessedAtMs = Date.parse(assessment.assessedAt);
  const stale = !Number.isFinite(assessedAtMs) || now.getTime() - assessedAtMs > GUARDIAN_FRESH_MS;
  return {
    freshness: stale ? ("stale" as const) : ("fresh" as const),
    reason: stale ? ADMIN_REASON.guardianAssessmentStale : null,
    assessmentId: assessment.assessmentId,
    assessedAt: assessment.assessedAt,
    recommendation: assessment.recommendation,
    openPositionSufficiency: assessment.openPositionSufficiency,
    newOpportunitySufficiency: assessment.newOpportunitySufficiency,
  };
}

export function positionMatchesMode(
  mode: "live" | "paper" | "history" | "all",
  attribution: Attribution,
): boolean {
  if (mode === "all") return true;
  return attribution.state === "attributed" && attribution.mode === mode;
}

export function presentOpenPosition(input: {
  id: string;
  organizationId: string;
  symbol: string;
  venue: string;
  positionSide: string;
  openQty: string;
  remainingQty: string;
  avgCost: string;
  openedAt: string | null;
  guardian: PositionGuardianAssessment | null;
  attribution: Attribution;
  now: Date;
}) {
  const row = {
    id: input.id,
    organizationId: input.organizationId,
    symbol: input.symbol,
    venue: input.venue,
    positionSide: input.positionSide,
    openQty: input.openQty,
    remainingQty: input.remainingQty,
    avgCost: input.avgCost,
    openedAt: input.openedAt,
    guardian: presentGuardian(input.guardian, input.now),
    riskPermission: { state: "unavailable" as const, reason: ADMIN_REASON.riskPermissionNotLinked },
    executedReduction: {
      state: "unavailable" as const,
      reason: ADMIN_REASON.executedReductionNotLinked,
    },
  };
  if (input.attribution.state === "attributed") {
    return {
      ...row,
      attribution: {
        state: "attributed" as const,
        exchangeAccountId: input.attribution.exchangeAccountId,
        mode: input.attribution.mode,
        label: input.attribution.exchangeAccountId,
      },
    };
  }
  return {
    ...row,
    attribution: {
      state: input.attribution.state,
      reason: input.attribution.reason,
      label: "Не распределено",
    },
  };
}
