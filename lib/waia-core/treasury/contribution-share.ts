import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import { isApprovedV1UsdtAsset, requireBigint } from "@/lib/waia-core/treasury/money";
import type {
  TreasuryAttributionRecord,
  TreasuryAttributionStatus,
  TreasuryTransactionRecord,
} from "@/lib/waia-core/treasury/types";

export type ContributionShareTotals = {
  numeratorMicros: bigint;
  denominatorMicros: bigint;
};

/**
 * WP-2 reusable eligibility + exact numerator/denominator contract.
 * WP-7 owns the contribution share engine (HTTP, Breath, public lists).
 */
export function isQualifyingContribution(tx: TreasuryTransactionRecord): boolean {
  if (tx.kind !== "CONTRIBUTION") return false;
  if (tx.direction !== "INFLOW") return false;
  if (tx.status !== "VERIFIED") return false;
  if (tx.accountingAmountMicros === null) return false;
  if (!isApprovedV1UsdtAsset(tx)) return false;
  return true;
}

export function netQualifyingMicros(input: {
  contribution: TreasuryTransactionRecord;
  linkedVerifiedAdjustments: readonly TreasuryTransactionRecord[];
}): bigint {
  if (!isQualifyingContribution(input.contribution)) {
    return 0n;
  }
  let net = requireBigint(input.contribution.accountingAmountMicros, "accountingAmountMicros");
  for (const linked of input.linkedVerifiedAdjustments) {
    if (linked.status !== "VERIFIED") continue;
    if (linked.correctsTransactionId !== input.contribution.id) continue;
    if (
      linked.kind !== "CORRECTION" &&
      linked.kind !== "REFUND" &&
      linked.kind !== "BALANCE_ADJUSTMENT"
    ) {
      continue;
    }
    if (linked.cashEffectMicros === null) continue;
    net += requireBigint(linked.cashEffectMicros, "linkedCashEffect");
  }
  return net;
}

export function openAttributionStatus(
  attributions: readonly TreasuryAttributionRecord[],
): TreasuryAttributionStatus | null {
  const open = attributions.find((row) => row.revokedAt === null);
  return open?.status ?? null;
}

export function computeContributionShareTotals(input: {
  contributions: readonly TreasuryTransactionRecord[];
  adjustments: readonly TreasuryTransactionRecord[];
  attributionsByTransactionId: ReadonlyMap<string, readonly TreasuryAttributionRecord[]>;
  contributorUserId: string;
  expenses?: readonly TreasuryTransactionRecord[];
  commitmentsAmountMicros?: bigint;
}): ContributionShareTotals {
  void input.expenses;
  void input.commitmentsAmountMicros;
  let numeratorMicros = 0n;
  let denominatorMicros = 0n;

  for (const contribution of input.contributions) {
    const net = netQualifyingMicros({
      contribution,
      linkedVerifiedAdjustments: input.adjustments,
    });
    if (!isQualifyingContribution(contribution)) {
      continue;
    }
    const attributions = input.attributionsByTransactionId.get(contribution.id) ?? [];
    denominatorMicros += net;
    const attributed = attributions.find(
      (row) =>
        row.revokedAt === null &&
        row.status === "ATTRIBUTED" &&
        row.contributorUserId === input.contributorUserId,
    );
    if (attributed) {
      numeratorMicros += net;
    }
  }

  return { numeratorMicros, denominatorMicros };
}

export function contributionShareOrZero(totals: ContributionShareTotals): {
  numeratorMicros: bigint;
  denominatorMicros: bigint;
  isZeroShare: boolean;
} {
  const numeratorMicros = requireBigint(totals.numeratorMicros, "numerator");
  const denominatorMicros = requireBigint(totals.denominatorMicros, "denominator");
  if (denominatorMicros <= 0n) {
    return { numeratorMicros: 0n, denominatorMicros: 0n, isZeroShare: true };
  }
  if (numeratorMicros < 0n || denominatorMicros < 0n) {
    throw new TreasuryValidationError("SHARE_NEGATIVE", "share components must be non-negative");
  }
  return {
    numeratorMicros,
    denominatorMicros,
    isZeroShare: numeratorMicros === 0n,
  };
}
