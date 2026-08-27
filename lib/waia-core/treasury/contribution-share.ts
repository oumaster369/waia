/**
 * Frozen §6 contribution-share primitives.
 * WP-7 owns the contribution share engine; this module is the exact
 * Q / TRC-20 / REFUND+CORRECTION netting / current-open attribution contract.
 */
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import {
  isApprovedManualUsdAsset,
  isApprovedV1UsdtAsset,
  requireBigint,
} from "@/lib/waia-core/treasury/money";
import {
  TREASURY_USDT_V1_NETWORK,
  TREASURY_USDT_V1_TOKEN_CONTRACT,
} from "@/lib/waia-core/treasury/types";
import type {
  TreasuryAttributionRecord,
  TreasuryAttributionStatus,
  TreasuryTransactionRecord,
} from "@/lib/waia-core/treasury/types";

export type ContributionShareTotals = {
  numeratorMicros: bigint;
  denominatorMicros: bigint;
};

const SHARE_NETTING_KINDS = new Set<TreasuryTransactionRecord["kind"]>(["CORRECTION", "REFUND"]);

/**
 * Frozen §6 v1 asset identity: USDT TRC-20. `isApprovedV1UsdtAsset` is necessary
 * but not sufficient — it does not prove network/contract.
 */
export function isApprovedV1UsdtTrc20ContributionAsset(tx: TreasuryTransactionRecord): boolean {
  if (!isApprovedV1UsdtAsset(tx)) return false;
  if (tx.provenance === "WATCHER") {
    return (
      tx.canonicalNetwork === TREASURY_USDT_V1_NETWORK &&
      tx.canonicalTokenContract === TREASURY_USDT_V1_TOKEN_CONTRACT
    );
  }
  return tx.nativeContract === TREASURY_USDT_V1_TOKEN_CONTRACT;
}

/**
 * Frozen §6 qualifying contribution predicate (Q without linked-adjustment scan).
 */
export function isQualifyingContribution(tx: TreasuryTransactionRecord): boolean {
  if (tx.kind !== "CONTRIBUTION") return false;
  if (tx.direction !== "INFLOW") return false;
  if (tx.status !== "VERIFIED") return false;
  if (tx.accountingAmountMicros === null) return false;
  const approvedManualUsd = tx.provenance === "MANUAL" && isApprovedManualUsdAsset(tx);
  if (!isApprovedV1UsdtTrc20ContributionAsset(tx) && !approvedManualUsd) return false;
  return true;
}

export function isShareNettingAdjustment(tx: TreasuryTransactionRecord): boolean {
  return SHARE_NETTING_KINDS.has(tx.kind);
}

export function linkedReconciliationInvalidatesContribution(
  contribution: TreasuryTransactionRecord,
  allTransactions: readonly TreasuryTransactionRecord[],
): boolean {
  return allTransactions.some(
    (row) =>
      row.correctsTransactionId === contribution.id &&
      isShareNettingAdjustment(row) &&
      row.status === "RECONCILIATION_REQUIRED",
  );
}

function requireVerifiedAdjustmentCashEffect(tx: TreasuryTransactionRecord): bigint {
  if (tx.cashEffectMicros === null) {
    throw new TreasuryValidationError(
      "SHARE_ADJUSTMENT_INCOMPLETE",
      "VERIFIED REFUND/CORRECTION linked to a contribution is missing cashEffectMicros",
    );
  }
  return requireBigint(tx.cashEffectMicros, "cashEffectMicros");
}

/**
 * Frozen §6 net: qualifying base accounting amount plus direct VERIFIED
 * REFUND/CORRECTION cash effects via correctsTransactionId.
 * BALANCE_ADJUSTMENT is excluded. Null VERIFIED adjustment cash fails closed.
 */
export function netQualifyingMicros(input: {
  contribution: TreasuryTransactionRecord;
  linkedVerifiedAdjustments: readonly TreasuryTransactionRecord[];
}): bigint {
  if (!isQualifyingContribution(input.contribution)) {
    return 0n;
  }
  let net = requireBigint(input.contribution.accountingAmountMicros, "accountingAmountMicros");
  for (const linked of input.linkedVerifiedAdjustments) {
    if (linked.correctsTransactionId !== input.contribution.id) continue;
    if (!isShareNettingAdjustment(linked)) continue;
    if (linked.status !== "VERIFIED") continue;
    net += requireVerifiedAdjustmentCashEffect(linked);
  }
  return net;
}

export function requireCurrentOpenAttribution(
  attributions: readonly TreasuryAttributionRecord[],
): TreasuryAttributionRecord | null {
  const open = attributions.filter((row) => row.revokedAt === null);
  if (open.length > 1) {
    throw new TreasuryValidationError(
      "ATTRIBUTION_OPEN_AMBIGUOUS",
      "Multiple open attributions for one transaction",
    );
  }
  return open[0] ?? null;
}

export function openAttributionStatus(
  attributions: readonly TreasuryAttributionRecord[],
): TreasuryAttributionStatus | null {
  return requireCurrentOpenAttribution(attributions)?.status ?? null;
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
  const userId = input.contributorUserId.trim();
  let numeratorMicros = 0n;
  let denominatorMicros = 0n;
  const universe = [...input.contributions, ...input.adjustments];

  for (const contribution of input.contributions) {
    if (!isQualifyingContribution(contribution)) continue;
    if (linkedReconciliationInvalidatesContribution(contribution, universe)) continue;
    const net = netQualifyingMicros({
      contribution,
      linkedVerifiedAdjustments: input.adjustments,
    });
    const attributions = input.attributionsByTransactionId.get(contribution.id) ?? [];
    denominatorMicros += net;
    const open = requireCurrentOpenAttribution(attributions);
    if (
      open &&
      open.status === "ATTRIBUTED" &&
      typeof open.contributorUserId === "string" &&
      open.contributorUserId.length > 0 &&
      open.contributorUserId === userId
    ) {
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
  if (numeratorMicros < 0n) {
    throw new TreasuryValidationError("SHARE_NEGATIVE", "share components must be non-negative");
  }
  return {
    numeratorMicros,
    denominatorMicros,
    isZeroShare: numeratorMicros === 0n,
  };
}
