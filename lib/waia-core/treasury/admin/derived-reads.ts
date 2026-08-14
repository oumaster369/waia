import {
  activeCommitmentsForBudget,
  assignedNegativeCashMagnitude,
  contributionFundedMicros,
} from "@/lib/waia-core/treasury/breath/accounting";
import type {
  TreasuryBudgetRecord,
  TreasuryFundingNeedRecord,
} from "@/lib/waia-core/treasury/admin/catalog-types";
import type {
  TreasuryCommitmentRecord,
  TreasuryTransactionRecord,
} from "@/lib/waia-core/treasury/types";

export type TreasuryBudgetDerivedTotals = {
  funded: bigint;
  committed: bigint;
  spent: bigint;
  remaining: bigint;
};

export type TreasuryFundingNeedDerivedTotals = {
  funded: bigint;
  remaining: bigint;
};

export function deriveBudgetAdminTotals(
  budget: TreasuryBudgetRecord,
  transactions: readonly TreasuryTransactionRecord[],
  commitments: readonly TreasuryCommitmentRecord[],
): TreasuryBudgetDerivedTotals {
  const funded = contributionFundedMicros(transactions, (tx) => tx.budgetId === budget.id);
  const committed = activeCommitmentsForBudget(commitments, budget.id);
  const spent = assignedNegativeCashMagnitude(transactions, budget.id);
  const remaining = budget.plannedAmountMicros - spent - committed;
  return { funded, committed, spent, remaining };
}

export function deriveFundingNeedAdminTotals(
  need: TreasuryFundingNeedRecord,
  transactions: readonly TreasuryTransactionRecord[],
): TreasuryFundingNeedDerivedTotals {
  const funded = contributionFundedMicros(transactions, (tx) => tx.fundingNeedId === need.id);
  const remaining = need.requiredAmountMicros - funded;
  return { funded, remaining };
}
