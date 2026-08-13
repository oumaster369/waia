import { isActiveCommittedStatus } from "@/lib/waia-core/treasury/commitment-fsm";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import { requireBigint } from "@/lib/waia-core/treasury/money";
import type {
  TreasuryCommitmentRecord,
  TreasuryTransactionRecord,
} from "@/lib/waia-core/treasury/types";
import {
  BREATH_FILL_RATIO_SCALE,
  breathPendingReasons,
  type BreathAccountingTotals,
} from "@/lib/waia-core/treasury/breath/types";

export function requireVerifiedCashEffect(tx: TreasuryTransactionRecord): bigint {
  if (tx.status !== "VERIFIED") {
    throw new TreasuryValidationError(
      "VERIFIED_REQUIRED",
      "Only VERIFIED rows are accounting truth",
    );
  }
  if (tx.cashEffectMicros === null) {
    throw new TreasuryValidationError(
      breathPendingReasons.VERIFIED_FINANCIAL_ROW_INCOMPLETE,
      "VERIFIED row is missing cashEffectMicros",
    );
  }
  return requireBigint(tx.cashEffectMicros, "cashEffectMicros");
}

export function computeVerifiedAccountingTotals(
  transactions: readonly TreasuryTransactionRecord[],
): BreathAccountingTotals {
  let accountingCashBalance = 0n;
  let entered = 0n;
  let spent = 0n;
  for (const tx of transactions) {
    if (tx.status !== "VERIFIED") continue;
    const effect = requireVerifiedCashEffect(tx);
    accountingCashBalance += effect;
    if (effect > 0n) entered += effect;
    if (effect < 0n) spent += -effect;
  }
  const remaining = entered - spent;
  if (remaining !== accountingCashBalance) {
    throw new TreasuryValidationError(
      breathPendingReasons.IDENTITY_MISMATCH,
      "resources.remaining must equal accountingCashBalance",
    );
  }
  return { accountingCashBalance, entered, spent, remaining };
}

export function deriveActiveCommittedFunds(
  commitments: readonly TreasuryCommitmentRecord[],
): bigint {
  let total = 0n;
  for (const commitment of commitments) {
    if (!isActiveCommittedStatus(commitment.status)) continue;
    total += requireBigint(commitment.amountMicros, "amountMicros");
  }
  return total;
}

export function deriveCurrentFreeFunds(
  accountingCashBalance: bigint,
  activeCommittedFunds: bigint,
): bigint {
  const free = accountingCashBalance - activeCommittedFunds;
  return free > 0n ? free : 0n;
}

export function budgetFillRatioDisplay(funded: bigint, planned: bigint): number | null {
  if (planned <= 0n) return null;
  let scaled = (funded * BREATH_FILL_RATIO_SCALE) / planned;
  if (scaled < 0n) scaled = 0n;
  if (scaled > BREATH_FILL_RATIO_SCALE) scaled = BREATH_FILL_RATIO_SCALE;
  return Number(scaled) / Number(BREATH_FILL_RATIO_SCALE);
}

export function contributionFundedMicros(
  transactions: readonly TreasuryTransactionRecord[],
  match: (tx: TreasuryTransactionRecord) => boolean,
): bigint {
  let total = 0n;
  for (const tx of transactions) {
    if (tx.status !== "VERIFIED" || tx.kind !== "CONTRIBUTION" || !match(tx)) continue;
    if (tx.accountingAmountMicros === null) {
      throw new TreasuryValidationError(
        breathPendingReasons.VERIFIED_FINANCIAL_ROW_INCOMPLETE,
        "VERIFIED CONTRIBUTION is missing accountingAmountMicros",
      );
    }
    total += requireBigint(tx.accountingAmountMicros, "accountingAmountMicros");
  }
  return total;
}

export function assignedNegativeCashMagnitude(
  transactions: readonly TreasuryTransactionRecord[],
  budgetId: string,
): bigint {
  let total = 0n;
  for (const tx of transactions) {
    if (tx.status !== "VERIFIED" || tx.budgetId !== budgetId) continue;
    const effect = requireVerifiedCashEffect(tx);
    if (effect < 0n) total += -effect;
  }
  return total;
}

export function activeCommitmentsForBudget(
  commitments: readonly TreasuryCommitmentRecord[],
  budgetId: string,
): bigint {
  let total = 0n;
  for (const commitment of commitments) {
    if (!isActiveCommittedStatus(commitment.status) || commitment.budgetId !== budgetId) continue;
    total += requireBigint(commitment.amountMicros, "amountMicros");
  }
  return total;
}
