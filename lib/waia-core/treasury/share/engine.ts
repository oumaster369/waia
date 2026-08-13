import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { serializeMicros } from "@/lib/waia-core/treasury/money";
import {
  contributionShareOrZero,
  isQualifyingContribution,
  isShareNettingAdjustment,
  linkedReconciliationInvalidatesContribution,
  netQualifyingMicros,
  requireCurrentOpenAttribution,
} from "@/lib/waia-core/treasury/contribution-share";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import type {
  TreasuryAttributionRecord,
  TreasuryTransactionRecord,
} from "@/lib/waia-core/treasury/types";
import type { ContributionShareFactsRepository } from "@/lib/waia-core/treasury/share/repository.types";
import type {
  PublicContributionAggregate,
  SelfContributionShare,
  ShareAttributionFact,
} from "@/lib/waia-core/treasury/share/types";

function maxDate(dates: Array<Date | null | undefined>): Date | null {
  let max: Date | null = null;
  for (const date of dates) {
    if (!date) continue;
    if (!max || date.getTime() > max.getTime()) max = date;
  }
  return max;
}

function attributionsByTransaction(
  attributions: readonly ShareAttributionFact[],
): Map<string, ShareAttributionFact[]> {
  const map = new Map<string, ShareAttributionFact[]>();
  for (const row of attributions) {
    const list = map.get(row.transactionId) ?? [];
    list.push(row);
    map.set(row.transactionId, list);
  }
  return map;
}

function asAttributionRecords(rows: readonly ShareAttributionFact[]): TreasuryAttributionRecord[] {
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    transactionId: row.transactionId,
    status: row.status,
    contributorUserId: row.contributorUserId,
    revokedAt: row.revokedAt,
  }));
}

function qualifyingSet(
  transactions: readonly TreasuryTransactionRecord[],
): TreasuryTransactionRecord[] {
  return transactions.filter(
    (tx) =>
      isQualifyingContribution(tx) &&
      !linkedReconciliationInvalidatesContribution(tx, transactions),
  );
}

function lastUpdatedFromUsed(input: {
  qualifying: readonly TreasuryTransactionRecord[];
  allTransactions: readonly TreasuryTransactionRecord[];
  attributions: readonly ShareAttributionFact[];
}): Date | null {
  const qIds = new Set(input.qualifying.map((row) => row.id));
  const adjustmentTimes = input.allTransactions
    .filter(
      (row) =>
        row.status === "VERIFIED" &&
        isShareNettingAdjustment(row) &&
        row.correctsTransactionId !== null &&
        qIds.has(row.correctsTransactionId),
    )
    .map((row) => row.updatedAt);
  const attributionTimes = input.attributions
    .filter((row) => qIds.has(row.transactionId))
    .flatMap((row) => [row.createdAt, row.attributedAt, row.revokedAt]);
  return maxDate([
    ...input.qualifying.flatMap((row) => [row.verifiedAt, row.updatedAt]),
    ...adjustmentTimes,
    ...attributionTimes,
  ]);
}

export type ContributionShareEngine = {
  computeSelfShare(
    context: OrgContext,
    authenticatedUserId: string,
  ): Promise<SelfContributionShare>;
  computePublicAggregate(context: OrgContext): Promise<PublicContributionAggregate>;
};

export function createContributionShareEngine(
  facts: ContributionShareFactsRepository,
): ContributionShareEngine {
  return {
    async computeSelfShare(context, authenticatedUserId) {
      const org = requireOrgContext(context.organizationId);
      const userId = authenticatedUserId.trim();
      if (!userId) {
        throw new TreasuryValidationError("USER_ID_REQUIRED", "authenticated user id is required");
      }
      const loaded = await facts.loadFacts(org);
      const qualifying = qualifyingSet(loaded.transactions);
      const byTx = attributionsByTransaction(loaded.attributions);
      let numeratorMicros = 0n;
      let denominatorMicros = 0n;
      for (const contribution of qualifying) {
        const net = netQualifyingMicros({
          contribution,
          linkedVerifiedAdjustments: loaded.transactions,
        });
        denominatorMicros += net;
        const open = requireCurrentOpenAttribution(
          asAttributionRecords(byTx.get(contribution.id) ?? []),
        );
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
      const share = contributionShareOrZero({ numeratorMicros, denominatorMicros });
      const lastUpdated = lastUpdatedFromUsed({
        qualifying,
        allTransactions: loaded.transactions,
        attributions: loaded.attributions,
      });
      return {
        numeratorMicros: serializeMicros(share.numeratorMicros),
        denominatorMicros: serializeMicros(share.denominatorMicros),
        isZeroShare: share.isZeroShare,
        lastUpdatedAt: lastUpdated ? lastUpdated.toISOString() : null,
      };
    },

    async computePublicAggregate(context) {
      const org = requireOrgContext(context.organizationId);
      const loaded = await facts.loadFacts(org);
      const qualifying = qualifyingSet(loaded.transactions);
      let total = 0n;
      for (const contribution of qualifying) {
        total += netQualifyingMicros({
          contribution,
          linkedVerifiedAdjustments: loaded.transactions,
        });
      }
      const lastUpdated = lastUpdatedFromUsed({
        qualifying,
        allTransactions: loaded.transactions,
        attributions: loaded.attributions,
      });
      return {
        totalNetContributionMicros: serializeMicros(total),
        qualifyingContributionCount: qualifying.length,
        lastUpdatedAt: lastUpdated ? lastUpdated.toISOString() : null,
      };
    },
  };
}
