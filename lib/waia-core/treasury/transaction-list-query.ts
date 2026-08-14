import type { TreasuryTransactionRecord } from "@/lib/waia-core/treasury/types";

export const TREASURY_REVIEW_REQUIRED_STATUSES = [
  "DETECTED",
  "NEEDS_REVIEW",
  "CLASSIFIED",
  "RECONCILIATION_REQUIRED",
] as const;

export type TreasuryReviewRequiredStatus = (typeof TREASURY_REVIEW_REQUIRED_STATUSES)[number];

export type TreasuryTransactionListQuery = {
  status?: TreasuryTransactionRecord["status"];
  detailPublication?: TreasuryTransactionRecord["detailPublication"];
  kind?: TreasuryTransactionRecord["kind"];
  direction?: TreasuryTransactionRecord["direction"];
  canonicalNetwork?: string;
  canonicalTokenContract?: string;
  projectModule?: string;
  budgetId?: string;
  category?: string;
  occurredAtFrom?: Date;
  occurredAtTo?: Date;
  provenance?: TreasuryTransactionRecord["provenance"];
  nativeAsset?: string;
  limit?: number;
  offset?: number;
};

export type TreasuryOverviewCounts = {
  reviewRequiredCount: number;
  publicationPendingCount: number;
};

const REVIEW_REQUIRED = new Set<string>(TREASURY_REVIEW_REQUIRED_STATUSES);

export function transactionMatchesListQuery(
  row: TreasuryTransactionRecord,
  query: TreasuryTransactionListQuery,
): boolean {
  if (query.status !== undefined && row.status !== query.status) return false;
  if (query.detailPublication !== undefined && row.detailPublication !== query.detailPublication) {
    return false;
  }
  if (query.kind !== undefined && row.kind !== query.kind) return false;
  if (query.direction !== undefined && row.direction !== query.direction) return false;
  if (query.canonicalNetwork !== undefined && row.canonicalNetwork !== query.canonicalNetwork) {
    return false;
  }
  if (
    query.canonicalTokenContract !== undefined &&
    row.canonicalTokenContract !== query.canonicalTokenContract
  ) {
    return false;
  }
  if (query.projectModule !== undefined && row.projectModule !== query.projectModule) return false;
  if (query.budgetId !== undefined && row.budgetId !== query.budgetId) return false;
  if (query.category !== undefined && row.category !== query.category) return false;
  if (query.provenance !== undefined && row.provenance !== query.provenance) return false;
  if (query.nativeAsset !== undefined && row.nativeAsset !== query.nativeAsset) return false;
  if (
    query.occurredAtFrom !== undefined &&
    row.occurredAt.getTime() < query.occurredAtFrom.getTime()
  ) {
    return false;
  }
  if (query.occurredAtTo !== undefined && row.occurredAt.getTime() > query.occurredAtTo.getTime()) {
    return false;
  }
  return true;
}

export function finalizeTransactionList(
  rows: readonly TreasuryTransactionRecord[],
  query?: TreasuryTransactionListQuery,
): TreasuryTransactionRecord[] {
  const matched = query ? rows.filter((row) => transactionMatchesListQuery(row, query)) : [...rows];
  matched.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  if (!query) return matched;
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.min(100, Math.max(1, query.limit ?? 50));
  return matched.slice(offset, offset + limit);
}

export function countTreasuryOverview(
  rows: readonly TreasuryTransactionRecord[],
): TreasuryOverviewCounts {
  let reviewRequiredCount = 0;
  let publicationPendingCount = 0;
  for (const row of rows) {
    if (REVIEW_REQUIRED.has(row.status)) reviewRequiredCount += 1;
    if (row.status === "VERIFIED" && row.detailPublication === "PRIVATE") {
      publicationPendingCount += 1;
    }
  }
  return { reviewRequiredCount, publicationPendingCount };
}
