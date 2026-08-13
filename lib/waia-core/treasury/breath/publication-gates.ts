import type {
  TreasuryBudgetRecord,
  TreasuryFundingNeedRecord,
  TreasuryIdealBudgetRecord,
  TreasuryRunwayPlanRecord,
} from "@/lib/waia-core/treasury/admin/catalog-types";
import type {
  TreasuryInceptionRecord,
  TreasuryTransactionRecord,
} from "@/lib/waia-core/treasury/types";
import type { TreasuryBalanceReconciliationRecord } from "@/lib/waia-core/treasury/watcher/types";
import {
  BREATH_RECON_MAX_AGE_MS,
  ELIGIBLE_PUBLIC_FUNDING_NEED_STATUSES,
  breathPendingReasons,
  type BreathPendingReason,
} from "@/lib/waia-core/treasury/breath/types";

function currentlyEffective(now: Date, from: Date, to: Date | null): boolean {
  if (from.getTime() > now.getTime()) return false;
  if (to && to.getTime() < now.getTime()) return false;
  return true;
}

function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function selectCurrentPublicBudgets(
  budgets: readonly TreasuryBudgetRecord[],
  now: Date,
): TreasuryBudgetRecord[] {
  const today = isoDate(now);
  return budgets.filter(
    (row) =>
      row.status === "ACTIVE" && row.isPublic && row.periodStart <= today && row.periodEnd >= today,
  );
}

export function selectEligiblePublicFundingNeeds(
  needs: readonly TreasuryFundingNeedRecord[],
): TreasuryFundingNeedRecord[] {
  const allowed = new Set<string>(ELIGIBLE_PUBLIC_FUNDING_NEED_STATUSES);
  return needs.filter((row) => row.isPublic && allowed.has(row.status));
}

export function selectApplicablePublicIdeals(
  ideals: readonly TreasuryIdealBudgetRecord[],
  now: Date,
): TreasuryIdealBudgetRecord[] {
  return ideals.filter(
    (row) =>
      row.status === "ACTIVE" &&
      row.publicationState === "PUBLIC" &&
      currentlyEffective(now, row.effectiveFrom, row.effectiveTo),
  );
}

export function selectActiveRunwayPlans(
  plans: readonly TreasuryRunwayPlanRecord[],
  now: Date,
): TreasuryRunwayPlanRecord[] {
  return plans.filter(
    (row) =>
      row.status === "ACTIVE" &&
      row.dailyBurnMicros > 0n &&
      currentlyEffective(now, row.effectiveFrom, row.effectiveTo),
  );
}

export function latestReconciliation(
  rows: readonly TreasuryBalanceReconciliationRecord[],
): TreasuryBalanceReconciliationRecord | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    const byTime = b.createdAt.getTime() - a.createdAt.getTime();
    if (byTime !== 0) return byTime;
    return b.id.localeCompare(a.id);
  })[0]!;
}

export function evaluateMaterialUnresolvedReconciliation(
  transactions: readonly TreasuryTransactionRecord[],
): boolean {
  for (const tx of transactions) {
    if (tx.status !== "RECONCILIATION_REQUIRED") continue;
    if (tx.kind === "INTERNAL_TRANSFER" && tx.cashEffectMicros === 0n) continue;
    if (tx.cashEffectMicros === 0n) continue;
    return true;
  }
  return false;
}

export function evaluateBalanceReconciliationGate(input: {
  latest: TreasuryBalanceReconciliationRecord | null;
  inceptions: readonly TreasuryInceptionRecord[];
  now: Date;
}): { ok: boolean; reason: BreathPendingReason | null } {
  if (!input.latest) {
    return { ok: false, reason: breathPendingReasons.BALANCE_RECONCILIATION_MISSING };
  }
  const active = input.inceptions.filter((row) => row.status === "ACTIVE");
  if (active.length !== 1) {
    return { ok: false, reason: breathPendingReasons.BALANCE_RECONCILIATION_SCOPE_INVALID };
  }
  if (input.latest.ledgerInceptionId !== active[0]!.id) {
    return { ok: false, reason: breathPendingReasons.BALANCE_RECONCILIATION_SCOPE_INVALID };
  }
  const ageMs = input.now.getTime() - input.latest.createdAt.getTime();
  if (ageMs > BREATH_RECON_MAX_AGE_MS) {
    return { ok: false, reason: breathPendingReasons.BALANCE_RECONCILIATION_STALE };
  }
  if (input.latest.status === "UNAVAILABLE") {
    return { ok: false, reason: breathPendingReasons.BALANCE_RECONCILIATION_UNAVAILABLE };
  }
  if (input.latest.status === "MISMATCH") {
    return { ok: false, reason: breathPendingReasons.BALANCE_RECONCILIATION_MISMATCH };
  }
  if (input.latest.toleranceMicros !== 0n) {
    return { ok: false, reason: breathPendingReasons.BALANCE_RECONCILIATION_PENDING_UNEXPLAINED };
  }
  if (input.latest.status === "MATCHED") {
    if (
      input.latest.deltaMicros === null ||
      input.latest.unexplainedResidualMicros === null ||
      input.latest.observedOnchainBalanceAtomic === null ||
      input.latest.accountingCashBalanceMicros === null ||
      input.latest.deltaMicros !== 0n ||
      input.latest.unexplainedResidualMicros !== 0n ||
      input.latest.deltaMicros !==
        input.latest.observedOnchainBalanceAtomic - input.latest.accountingCashBalanceMicros
    ) {
      return { ok: false, reason: breathPendingReasons.BALANCE_RECONCILIATION_PENDING_UNEXPLAINED };
    }
    return { ok: true, reason: null };
  }
  if (input.latest.status === "PENDING_CONFIRMATIONS") {
    if (
      input.latest.deltaMicros === null ||
      input.latest.unexplainedResidualMicros === null ||
      input.latest.unexplainedResidualMicros !== 0n ||
      input.latest.deltaMicros !== input.latest.explainedPendingMicros
    ) {
      return { ok: false, reason: breathPendingReasons.BALANCE_RECONCILIATION_PENDING_UNEXPLAINED };
    }
    return { ok: true, reason: null };
  }
  return { ok: false, reason: breathPendingReasons.BALANCE_RECONCILIATION_UNAVAILABLE };
}

export function collectGlobalPendingReasons(input: {
  breathEnabled: boolean;
  idealCount: number;
  materialReconciliation: boolean;
  balanceGate: { ok: boolean; reason: BreathPendingReason | null };
  verifiedIncomplete: boolean;
}): BreathPendingReason[] {
  const reasons: BreathPendingReason[] = [];
  if (!input.breathEnabled) reasons.push(breathPendingReasons.BREATH_DISABLED);
  if (input.idealCount === 0) reasons.push(breathPendingReasons.IDEAL_BUDGET_MISSING);
  if (input.idealCount > 1) reasons.push(breathPendingReasons.IDEAL_BUDGET_AMBIGUOUS);
  if (input.materialReconciliation) {
    reasons.push(breathPendingReasons.MATERIAL_RECONCILIATION_REQUIRED);
  }
  if (!input.balanceGate.ok && input.balanceGate.reason) reasons.push(input.balanceGate.reason);
  if (input.verifiedIncomplete) {
    reasons.push(breathPendingReasons.VERIFIED_FINANCIAL_ROW_INCOMPLETE);
  }
  return reasons;
}
