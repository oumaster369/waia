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
  SelfContributionRecord,
  SelfContributionShare,
  ShareAttributionFact,
} from "@/lib/waia-core/treasury/share/types";

const SHARE_PARTS_PER_MILLION = 1_000_000n;

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

function includedShareAdjustments(
  qualifying: readonly TreasuryTransactionRecord[],
  allTransactions: readonly TreasuryTransactionRecord[],
): TreasuryTransactionRecord[] {
  const qIds = new Set(qualifying.map((row) => row.id));
  return allTransactions.filter(
    (row) =>
      row.status === "VERIFIED" &&
      isShareNettingAdjustment(row) &&
      row.correctsTransactionId !== null &&
      qIds.has(row.correctsTransactionId),
  );
}

/**
 * Public aggregate lastUpdatedAt depends only on facts that can change
 * totalNetContributionMicros / qualifyingContributionCount.
 * Attribution timestamps are excluded.
 */
function lastUpdatedForPublicAggregate(
  qualifying: readonly TreasuryTransactionRecord[],
  allTransactions: readonly TreasuryTransactionRecord[],
): Date | null {
  const included = includedShareAdjustments(qualifying, allTransactions);
  return maxDate([
    ...qualifying.flatMap((row) => [row.verifiedAt, row.updatedAt]),
    ...included.flatMap((row) => [row.verifiedAt, row.updatedAt]),
  ]);
}

/**
 * Self-share lastUpdatedAt includes attribution lifecycle times because
 * numerator depends on the current open ATTRIBUTED row.
 */
function lastUpdatedForSelfShare(
  qualifying: readonly TreasuryTransactionRecord[],
  allTransactions: readonly TreasuryTransactionRecord[],
  attributions: readonly ShareAttributionFact[],
): Date | null {
  const qIds = new Set(qualifying.map((row) => row.id));
  const attributionTimes = attributions
    .filter((row) => qIds.has(row.transactionId))
    .flatMap((row) => [row.createdAt, row.attributedAt, row.revokedAt]);
  return maxDate([lastUpdatedForPublicAggregate(qualifying, allTransactions), ...attributionTimes]);
}

export type ContributionShareEngine = {
  computeSelfShare(
    context: OrgContext,
    authenticatedUserId: string,
  ): Promise<SelfContributionShare>;
  computeSelfRecord(
    context: OrgContext,
    authenticatedUserId: string,
  ): Promise<SelfContributionRecord>;
  computePublicAggregate(context: OrgContext): Promise<PublicContributionAggregate>;
};

function deriveSelfRecord(input: {
  transactions: readonly TreasuryTransactionRecord[];
  attributions: readonly ShareAttributionFact[];
  userId: string;
}): SelfContributionRecord {
  const qualifying = qualifyingSet(input.transactions);
  const byTx = attributionsByTransaction(input.attributions);
  let numeratorMicros = 0n;
  let denominatorMicros = 0n;
  const contributions: SelfContributionRecord["contributions"] = [];

  for (const contribution of qualifying) {
    const net = netQualifyingMicros({
      contribution,
      linkedVerifiedAdjustments: input.transactions,
    });
    denominatorMicros += net;
    const open = requireCurrentOpenAttribution(
      asAttributionRecords(byTx.get(contribution.id) ?? []),
    );
    if (
      open?.status === "ATTRIBUTED" &&
      typeof open.contributorUserId === "string" &&
      open.contributorUserId === input.userId
    ) {
      numeratorMicros += net;
      contributions.push({
        transactionId: contribution.id,
        occurredAt: contribution.occurredAt.toISOString(),
        contributedAmountMicros: serializeMicros(net),
      });
    }
  }

  contributions.sort((a, b) => {
    const byTime = Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
    return byTime !== 0 ? byTime : b.transactionId.localeCompare(a.transactionId);
  });
  const share = contributionShareOrZero({ numeratorMicros, denominatorMicros });
  const partsPerMillion =
    share.denominatorMicros > 0n
      ? (share.numeratorMicros * SHARE_PARTS_PER_MILLION) / share.denominatorMicros
      : 0n;
  const lastUpdated = lastUpdatedForSelfShare(qualifying, input.transactions, input.attributions);
  return {
    numeratorMicros: serializeMicros(share.numeratorMicros),
    denominatorMicros: serializeMicros(share.denominatorMicros),
    isZeroShare: share.isZeroShare,
    partsPerMillion: serializeMicros(partsPerMillion),
    contributions,
    lastUpdatedAt: lastUpdated ? lastUpdated.toISOString() : null,
  };
}

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
      const [transactions, attributions] = await Promise.all([
        facts.loadContributionFacts(org),
        facts.loadAttributionFacts(org),
      ]);
      const record = deriveSelfRecord({ transactions, attributions, userId });
      return {
        numeratorMicros: record.numeratorMicros,
        denominatorMicros: record.denominatorMicros,
        isZeroShare: record.isZeroShare,
        lastUpdatedAt: record.lastUpdatedAt,
      };
    },

    async computeSelfRecord(context, authenticatedUserId) {
      const org = requireOrgContext(context.organizationId);
      const userId = authenticatedUserId.trim();
      if (!userId) {
        throw new TreasuryValidationError("USER_ID_REQUIRED", "authenticated user id is required");
      }
      const [transactions, attributions] = await Promise.all([
        facts.loadContributionFacts(org),
        facts.loadAttributionFacts(org),
      ]);
      return deriveSelfRecord({ transactions, attributions, userId });
    },

    async computePublicAggregate(context) {
      const org = requireOrgContext(context.organizationId);
      const transactions = await facts.loadContributionFacts(org);
      const qualifying = qualifyingSet(transactions);
      let total = 0n;
      for (const contribution of qualifying) {
        total += netQualifyingMicros({
          contribution,
          linkedVerifiedAdjustments: transactions,
        });
      }
      const lastUpdated = lastUpdatedForPublicAggregate(qualifying, transactions);
      return {
        totalNetContributionMicros: serializeMicros(total),
        qualifyingContributionCount: qualifying.length,
        lastUpdatedAt: lastUpdated ? lastUpdated.toISOString() : null,
      };
    },
  };
}
