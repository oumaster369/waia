import type { AdminMode } from "@/lib/trader/admin-console/contracts";
import { ADMIN_REASON } from "@/lib/trader/admin-console/reason-codes";
import { compareDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";

export const GUARDIAN_FRESH_AFTER_MS = 15 * 60 * 1000;
export const UNALLOCATED_LABEL = "Не распределено";

const GUARDIAN_LABELS: Record<string, string> = {
  HOLD: "Держать",
  REDUCE_PARTIAL: "Сократить частично",
  REDUCE_FULL: "Закрыть полностью",
};

const RISK_LABELS: Record<string, string> = {
  NORMAL: "Новые входы разрешены",
  CLOSE_ONLY: "Только закрытие",
  HALT: "Остановлено",
  KILLED: "Аварийная остановка",
};

export type GuardianAssessmentPick = {
  lotId: string;
  assessmentId: string;
  createdAt: string;
};

export type OpenLotInput = {
  lotId: string;
  organizationId: string;
  symbol: string;
  accountKey: string;
  openQty: string;
  remainingQty: string;
  avgCost: string;
  openedAt: string;
  exchangeAccountId: string | null;
  mode: AdminMode | null;
  attribution: "attributed" | "unattributed" | "ambiguous";
  openLotsInGroup: number;
  guardian: {
    recommendation: string;
    openPositionSufficiency: string;
    newOpportunitySufficiency: string;
    targetReductionBps: number;
    assessedAt: string;
  } | null;
  riskPosture: string | null;
  nowMs: number;
};

export type OpenLotView = {
  lotId: string;
  organizationId: string;
  symbol: string;
  accountKey: string;
  openQty: string;
  remainingQty: string;
  avgCost: string;
  openedAt: string;
  allocation: string;
  attributionReason: string | null;
  mode: AdminMode | null;
  positionGroupKey: string;
  openLotsInGroup: number;
  href: string;
  guardian: {
    state: "ok" | "stale";
    recommendation: string | null;
    recommendationLabel: string | null;
    openPositionSufficiency: string | null;
    newOpportunitySufficiency: string | null;
    targetReductionBps: number | null;
    assessedAt: string | null;
    reasons: string[];
  };
  riskPermission: {
    state: "ok" | "unavailable";
    posture: string | null;
    label: string | null;
    reasons: string[];
  };
  executedReduction: {
    state: "ok" | "unavailable";
    quantity: string | null;
    reasons: string[];
  };
};

/** Mirrors `DISTINCT ON (lot_id) ORDER BY lot_id, created_at DESC, assessment_id DESC`. */
export function latestGuardianByLot<T extends GuardianAssessmentPick>(
  rows: readonly T[],
): Map<string, T> {
  const latest = new Map<string, T>();
  const ordered = [...rows].sort((left, right) => {
    if (left.lotId !== right.lotId) return left.lotId < right.lotId ? -1 : 1;
    if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1;
    if (left.assessmentId !== right.assessmentId) {
      return left.assessmentId < right.assessmentId ? 1 : -1;
    }
    return 0;
  });
  for (const row of ordered) {
    if (!latest.has(row.lotId)) latest.set(row.lotId, row);
  }
  return latest;
}

export function guardianFreshness(input: { assessedAt: string | null; nowMs: number }): {
  state: "ok" | "stale";
  reasons: string[];
} {
  if (!input.assessedAt) {
    return { state: "stale", reasons: [ADMIN_REASON.guardianAssessmentMissing] };
  }
  const at = Date.parse(input.assessedAt);
  if (!Number.isFinite(at) || input.nowMs - at > GUARDIAN_FRESH_AFTER_MS) {
    return { state: "stale", reasons: [ADMIN_REASON.guardianAssessmentStale] };
  }
  return { state: "ok", reasons: [] };
}

function executedReduction(
  openQty: string,
  remainingQty: string,
): OpenLotView["executedReduction"] {
  try {
    if (compareDecimal(remainingQty, openQty) > 0) {
      return { state: "unavailable", quantity: null, reasons: [ADMIN_REASON.lotQtyInconsistent] };
    }
    return {
      state: "ok",
      quantity: subtractDecimal(openQty, remainingQty),
      reasons: [],
    };
  } catch {
    return { state: "unavailable", quantity: null, reasons: [ADMIN_REASON.lotQtyInconsistent] };
  }
}

function riskPermission(posture: string | null): OpenLotView["riskPermission"] {
  if (!posture) {
    return {
      state: "unavailable",
      posture: null,
      label: null,
      reasons: [ADMIN_REASON.riskAccountUnmatched],
    };
  }
  const label = RISK_LABELS[posture];
  if (!label) {
    return {
      state: "unavailable",
      posture: null,
      label: null,
      reasons: [ADMIN_REASON.riskPostureUnknown],
    };
  }
  return { state: "ok", posture, label, reasons: [] };
}

export function presentOpenLot(input: OpenLotInput): OpenLotView {
  const freshness = guardianFreshness({
    assessedAt: input.guardian?.assessedAt ?? null,
    nowMs: input.nowMs,
  });
  const allocated = input.attribution === "attributed" && input.exchangeAccountId !== null;
  return {
    lotId: input.lotId,
    organizationId: input.organizationId,
    symbol: input.symbol,
    accountKey: input.accountKey,
    openQty: input.openQty,
    remainingQty: input.remainingQty,
    avgCost: input.avgCost,
    openedAt: input.openedAt,
    allocation: allocated ? input.exchangeAccountId! : UNALLOCATED_LABEL,
    attributionReason: allocated
      ? null
      : input.attribution === "ambiguous"
        ? ADMIN_REASON.attributionAmbiguous
        : ADMIN_REASON.unattributed,
    mode: allocated ? input.mode : null,
    positionGroupKey: `${input.organizationId}:${input.symbol}:${input.accountKey}`,
    openLotsInGroup: input.openLotsInGroup,
    href: `/admin/positions/${input.lotId}`,
    guardian: {
      state: freshness.state,
      recommendation: input.guardian?.recommendation ?? null,
      recommendationLabel: input.guardian
        ? (GUARDIAN_LABELS[input.guardian.recommendation] ?? input.guardian.recommendation)
        : null,
      openPositionSufficiency: input.guardian?.openPositionSufficiency ?? null,
      newOpportunitySufficiency: input.guardian?.newOpportunitySufficiency ?? null,
      targetReductionBps: input.guardian?.targetReductionBps ?? null,
      assessedAt: input.guardian?.assessedAt ?? null,
      reasons: freshness.reasons,
    },
    riskPermission: riskPermission(input.riskPosture),
    executedReduction: executedReduction(input.openQty, input.remainingQty),
  };
}
