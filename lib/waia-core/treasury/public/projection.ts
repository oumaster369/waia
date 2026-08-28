import {
  deriveCategoryBudgetAnnual,
  deriveCategoryBudgetMonth,
  type TreasuryCategoryBudgetAnnualSummary,
} from "@/lib/waia-core/treasury/admin/category-budget-truth";
import {
  computeVerifiedAccountingTotals,
  contributionFundedMicros,
  deriveCheckpointCashBalance,
  deriveActiveCommittedFunds,
  deriveCurrentFreeFunds,
  latestBalanceCheckpoint,
} from "@/lib/waia-core/treasury/breath/accounting";
import {
  evaluateBalanceReconciliationGate,
  evaluateMaterialUnresolvedReconciliation,
  latestReconciliation,
  selectActiveRunwayPlans,
  selectApplicablePublicIdeals,
} from "@/lib/waia-core/treasury/breath/publication-gates";
import { computeRunwayInputDigest } from "@/lib/waia-core/treasury/breath/runway";
import {
  isQualifyingContribution,
  linkedReconciliationInvalidatesContribution,
  netQualifyingMicros,
} from "@/lib/waia-core/treasury/contribution-share";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import type { TreasuryTransactionRecord } from "@/lib/waia-core/treasury/types";
import type {
  PublicTreasuryAttributionFact,
  PublicTreasuryFacts,
} from "@/lib/waia-core/treasury/public/repository.types";
import {
  PUBLIC_TREASURY_SCHEMA_VERSION,
  PUBLIC_TREASURY_SHARE_SCALE,
  PUBLIC_TREASURY_TRANSACTION_LIMIT,
  publicTreasuryPendingReasons,
  type PublicTreasuryBudget,
  type PublicTreasuryBudgetMonth,
  type PublicTreasuryFundingNeed,
  type PublicTreasuryPatrons,
  type PublicTreasuryPendingReason,
  type PublicTreasuryProjection,
  type PublicTreasuryRunway,
  type PublicTreasuryShare,
  type PublicTreasuryTransaction,
} from "@/lib/waia-core/treasury/public/types";
import { computeVirtualFundAllocation } from "@/lib/waia-core/treasury/allocation/engine";
import { evaluateFundAllocationFacts } from "@/lib/waia-core/treasury/allocation/service";
import {
  TREASURY_FUND_ALLOCATION_POLICY_CODE,
  TREASURY_FUND_ALLOCATION_POLICY_VERSION,
} from "@/lib/waia-core/treasury/allocation/types";

function maxDate(dates: Array<Date | null | undefined>): Date | null {
  let latest: Date | null = null;
  for (const date of dates) {
    if (date && (!latest || date.getTime() > latest.getTime())) latest = date;
  }
  return latest;
}

function money(value: bigint): string {
  return value.toString(10);
}

function uniqueReasons(reasons: readonly PublicTreasuryPendingReason[]) {
  return [...new Set(reasons)];
}

function assertFactScope(facts: PublicTreasuryFacts): void {
  const rows = [
    ...(facts.settings ? [facts.settings] : []),
    ...facts.transactions,
    ...facts.commitments,
    ...facts.fundingNeeds,
    ...facts.idealBudgets,
    ...facts.runwayPlans,
    ...facts.runwaySnapshots,
    ...facts.reconciliations,
    ...facts.inceptions,
    ...(facts.balanceCheckpoints ?? []),
    ...facts.categories,
    ...facts.categoryBudgetHistory,
    ...facts.projects,
    ...facts.attributions,
  ];
  if (rows.some((row) => row.organizationId !== facts.organizationId)) {
    throw new TreasuryValidationError(
      "PUBLIC_TREASURY_CROSS_ORG_FACT",
      "Public Treasury facts must belong to one organization",
    );
  }
}

function publicShare(numerator: bigint, denominator: bigint): PublicTreasuryShare {
  const parts = denominator > 0n ? (numerator * PUBLIC_TREASURY_SHARE_SCALE) / denominator : 0n;
  return {
    numeratorMicros: money(numerator),
    denominatorMicros: money(denominator),
    partsPerMillion: money(parts),
  };
}

function publicTransactions(input: {
  facts: PublicTreasuryFacts;
  currency: string;
  offset: number;
  limit: number;
}): { rows: PublicTreasuryTransaction[]; total: number } {
  const categoryById = new Map(input.facts.categories.map((row) => [row.id, row]));
  const projectById = new Map(input.facts.projects.map((row) => [row.id, row]));
  const monthCache = new Map<string, ReturnType<typeof deriveCategoryBudgetMonth>["categories"]>();

  function categoryGroup(tx: TreasuryTransactionRecord): string | null {
    if (!tx.categoryId) return null;
    const month = tx.occurredAt.toISOString().slice(0, 7);
    let rows = monthCache.get(month);
    if (!rows) {
      rows = deriveCategoryBudgetMonth({
        month,
        categories: input.facts.categories,
        history: input.facts.categoryBudgetHistory,
        transactions: input.facts.transactions,
      }).categories;
      monthCache.set(month, rows);
    }
    return rows.find((row) => row.categoryId === tx.categoryId)?.groupName ?? null;
  }

  const eligible = input.facts.transactions
    .filter(
      (tx) =>
        tx.status === "VERIFIED" &&
        tx.detailPublication === "DETAIL_PUBLIC" &&
        tx.duplicateOfTransactionId === null &&
        tx.detailSupersededById === null &&
        tx.cashEffectMicros !== null,
    )
    .sort((a, b) => {
      const byTime = b.occurredAt.getTime() - a.occurredAt.getTime();
      return byTime !== 0 ? byTime : a.recordContentDigest.localeCompare(b.recordContentDigest);
    });
  return {
    total: eligible.length,
    rows: eligible.slice(input.offset, input.offset + input.limit).map((tx) => ({
      occurredAt: tx.occurredAt.toISOString(),
      amountMicros: money(tx.cashEffectMicros!),
      currency: input.currency,
      categoryName: tx.categoryId ? (categoryById.get(tx.categoryId)?.name ?? null) : null,
      categoryGroup: categoryGroup(tx),
      projectName: tx.projectId ? (projectById.get(tx.projectId)?.name ?? null) : null,
      description: tx.publicDescription?.trim() || null,
    })),
  };
}

function serializeBudgetMonth(
  month: TreasuryCategoryBudgetAnnualSummary["months"][number],
  currency: string,
): PublicTreasuryBudgetMonth {
  return {
    month: month.month,
    categories: month.categories
      .filter((row) => row.currency === currency)
      .map((row) => ({
        code: row.code,
        name: row.name,
        groupName: row.groupName,
        currency: row.currency,
        budgetMicros: money(row.budgetMicros),
        spentMicros: money(row.spentMicros),
        remainingMicros: money(row.remainingMicros),
      })),
    groups: month.groups
      .filter((row) => row.currency === currency)
      .map((row) => ({
        groupName: row.groupName,
        currency: row.currency,
        budgetMicros: money(row.budgetMicros),
        spentMicros: money(row.spentMicros),
        remainingMicros: money(row.remainingMicros),
      })),
  };
}

function publicBudget(input: {
  facts: PublicTreasuryFacts;
  year: number;
  currency: string;
  amountMicros: bigint;
  now: Date;
}): PublicTreasuryBudget {
  try {
    const annual = deriveCategoryBudgetAnnual({
      year: input.year,
      categories: input.facts.categories,
      history: input.facts.categoryBudgetHistory,
      transactions: input.facts.transactions,
    });
    const currentMonthKey = `${input.year}-${String(input.now.getUTCMonth() + 1).padStart(2, "0")}`;
    const currentMonth = deriveCategoryBudgetMonth({
      month: currentMonthKey,
      categories: input.facts.categories,
      history: input.facts.categoryBudgetHistory,
      transactions: input.facts.transactions,
    });
    const matching = currentMonth.totals.find((row) => row.currency === input.currency);
    const conflicting = currentMonth.totals.some(
      (row) => row.currency !== input.currency && row.budgetMicros !== 0n,
    );
    if (!matching || conflicting || matching.budgetMicros * 12n !== input.amountMicros) {
      throw new TreasuryValidationError(
        "PUBLIC_ANNUAL_BUDGET_MISMATCH",
        "Published annual snapshot does not match category history",
      );
    }
    return {
      status: "published",
      year: input.year,
      currency: input.currency,
      annualBudgetAmountMicros: money(input.amountMicros),
      months: annual.months
        .filter((month) => month.month <= currentMonthKey)
        .map((month) => serializeBudgetMonth(month, input.currency))
        .sort((a, b) => b.month.localeCompare(a.month)),
    };
  } catch {
    return {
      status: "pending",
      year: null,
      currency: null,
      annualBudgetAmountMicros: null,
      months: [],
    };
  }
}

function publicFundingNeeds(input: {
  facts: PublicTreasuryFacts;
  currency: string;
}): PublicTreasuryFundingNeed[] {
  return input.facts.fundingNeeds
    .filter(
      (row): row is typeof row & { status: "OPEN" | "PARTIALLY_FUNDED" } =>
        row.isPublic &&
        (row.status === "OPEN" || row.status === "PARTIALLY_FUNDED") &&
        row.currency === input.currency,
    )
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
    .map((row) => {
      const funded = contributionFundedMicros(
        input.facts.transactions,
        (tx) => tx.fundingNeedId === row.id,
      );
      return {
        title: row.title,
        explanation: row.publicExplanation?.trim() || null,
        targetStage: row.targetStage?.trim() || null,
        status: row.status,
        currency: row.currency,
        requiredAmountMicros: money(row.requiredAmountMicros),
        fundedAmountMicros: money(funded),
        remainingAmountMicros: money(row.requiredAmountMicros - funded),
      };
    });
}

function openAttribution(
  rows: readonly PublicTreasuryAttributionFact[],
): PublicTreasuryAttributionFact | null | "ambiguous" {
  const open = rows.filter((row) => row.revokedAt === null);
  if (open.length > 1) return "ambiguous";
  return open[0] ?? null;
}

function publicPatrons(input: {
  facts: PublicTreasuryFacts;
  currency: string;
}): PublicTreasuryPatrons {
  const qualifying = input.facts.transactions.filter(
    (tx) =>
      isQualifyingContribution(tx) &&
      !linkedReconciliationInvalidatesContribution(tx, input.facts.transactions),
  );
  const qualifyingIds = new Set(qualifying.map((row) => row.id));
  const attributionByTransaction = new Map<string, PublicTreasuryAttributionFact[]>();
  for (const attribution of input.facts.attributions) {
    if (!qualifyingIds.has(attribution.transactionId)) continue;
    const current = attributionByTransaction.get(attribution.transactionId) ?? [];
    current.push(attribution);
    attributionByTransaction.set(attribution.transactionId, current);
  }
  const profileByUser = new Map(
    input.facts.profiles.map((row) => [row.userId, row.displayName.trim()]),
  );
  const publicByUser = new Map<
    string,
    {
      displayName: string;
      publicSiteUrl: string | null;
      twinProfileUrl: string | null;
      amountMicros: bigint;
    }
  >();
  let privateAmount = 0n;
  let denominator = 0n;

  for (const contribution of qualifying) {
    const net = netQualifyingMicros({
      contribution,
      linkedVerifiedAdjustments: input.facts.transactions,
    });
    if (net < 0n) {
      return {
        status: "pending",
        totalContributedAmountMicros: null,
        currency: null,
        patrons: [],
        privateSupport: null,
        lastUpdatedAt: null,
      };
    }
    const attribution = openAttribution(attributionByTransaction.get(contribution.id) ?? []);
    if (attribution === "ambiguous") {
      return {
        status: "pending",
        totalContributedAmountMicros: null,
        currency: null,
        patrons: [],
        privateSupport: null,
        lastUpdatedAt: null,
      };
    }
    denominator += net;
    // A verified CONTRIBUTION without identity attribution is still truthful
    // anonymous support. Ordinary inflows never enter `qualifying` above.
    if (!attribution) {
      privateAmount += net;
      continue;
    }
    const userId = attribution?.contributorUserId ?? null;
    const displayName = userId ? profileByUser.get(userId) : undefined;
    if (
      attribution?.status === "ATTRIBUTED" &&
      attribution.consentPublicIdentity &&
      userId &&
      displayName
    ) {
      const current = publicByUser.get(userId) ?? {
        displayName,
        publicSiteUrl: null,
        twinProfileUrl: null,
        amountMicros: 0n,
      };
      current.amountMicros += net;
      current.publicSiteUrl = attribution.publicSiteUrl ?? current.publicSiteUrl;
      current.twinProfileUrl = attribution.twinProfileUrl ?? current.twinProfileUrl;
      publicByUser.set(userId, current);
    } else {
      privateAmount += net;
    }
  }

  const publicRows = [...publicByUser.entries()]
    .sort((a, b) => {
      if (a[1].amountMicros !== b[1].amountMicros) {
        return a[1].amountMicros > b[1].amountMicros ? -1 : 1;
      }
      return a[1].displayName.localeCompare(b[1].displayName) || a[0].localeCompare(b[0]);
    })
    .map(([, row]) => ({
      displayName: row.displayName,
      publicSiteUrl: row.publicSiteUrl,
      twinProfileUrl: row.twinProfileUrl,
      contributedAmountMicros: money(row.amountMicros),
      currency: input.currency,
      share: publicShare(row.amountMicros, denominator),
    }));

  const linkedAdjustments = input.facts.transactions.filter(
    (row) =>
      row.status === "VERIFIED" &&
      (row.kind === "CORRECTION" || row.kind === "REFUND") &&
      row.correctsTransactionId !== null &&
      qualifyingIds.has(row.correctsTransactionId),
  );
  const usedAttributions = input.facts.attributions.filter((row) =>
    qualifyingIds.has(row.transactionId),
  );
  const publicUserIds = new Set(publicByUser.keys());
  const lastUpdated = maxDate([
    ...qualifying.flatMap((row) => [row.verifiedAt, row.updatedAt]),
    ...linkedAdjustments.flatMap((row) => [row.verifiedAt, row.updatedAt]),
    ...usedAttributions.flatMap((row) => [row.createdAt, row.attributedAt, row.revokedAt]),
    ...input.facts.profiles
      .filter((row) => publicUserIds.has(row.userId))
      .map((row) => row.updatedAt),
  ]);

  return {
    status: "published",
    totalContributedAmountMicros: money(denominator),
    currency: input.currency,
    patrons: publicRows,
    privateSupport:
      privateAmount > 0n
        ? {
            contributedAmountMicros: money(privateAmount),
            currency: input.currency,
            share: publicShare(privateAmount, denominator),
          }
        : null,
    lastUpdatedAt: lastUpdated?.toISOString() ?? null,
  };
}

function latestCurrentRunway(input: {
  facts: PublicTreasuryFacts;
  now: Date;
  freeFunds: bigint;
  currency: string;
}): PublicTreasuryRunway {
  const plans = selectActiveRunwayPlans(input.facts.runwayPlans, input.now);
  if (plans.length !== 1 || plans[0]!.currency !== input.currency) return { status: "pending" };
  const plan = plans[0]!;
  const digest = computeRunwayInputDigest({
    verified: input.facts.transactions,
    commitments: input.facts.commitments,
    plan,
    freeFundsAtAsOfMicros: input.freeFunds,
  });
  const snapshot = input.facts.runwaySnapshots
    .filter((row) => row.runwayPlanId === plan.id)
    .sort((a, b) => {
      const byTime = b.createdAt.getTime() - a.createdAt.getTime();
      return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
    })[0];
  if (
    !snapshot ||
    snapshot.inputDigest !== digest ||
    snapshot.freeFundsAtAsOfMicros !== input.freeFunds ||
    snapshot.approvedDailyBurnMicros !== plan.dailyBurnMicros
  ) {
    return { status: "pending" };
  }
  return {
    status: "published",
    asOf: snapshot.runwayAsOf.toISOString(),
    endsAt: snapshot.endsAt.toISOString(),
    currency: plan.currency,
    dailyBurnMicros: money(plan.dailyBurnMicros),
    hourlyBurnMicros: money(plan.dailyBurnMicros / 24n),
  };
}

export function derivePublicTreasuryProjection(
  facts: PublicTreasuryFacts,
  now: Date = new Date(),
  options: { transactionOffset?: number; transactionLimit?: number } = {},
): PublicTreasuryProjection {
  assertFactScope(facts);
  const reasons: PublicTreasuryPendingReason[] = [];
  const ideals = selectApplicablePublicIdeals(facts.idealBudgets, now);
  const latest = latestReconciliation(facts.reconciliations);
  const reconciliationGate = evaluateBalanceReconciliationGate({
    latest,
    inceptions: facts.inceptions,
    now,
  });
  const checkpoint = latestBalanceCheckpoint(
    facts.balanceCheckpoints ?? [],
    ideals.length === 1 ? ideals[0]!.currency : undefined,
  );
  const balanceGate = checkpoint ? { ok: true, reason: null } : reconciliationGate;
  const materialReconciliation = checkpoint
    ? evaluateMaterialUnresolvedReconciliation(
        facts.transactions.filter((row) => row.occurredAt.getTime() > checkpoint.asOf.getTime()),
      )
    : evaluateMaterialUnresolvedReconciliation(facts.transactions);

  if (facts.settings?.breathEnabled !== true) {
    reasons.push(publicTreasuryPendingReasons.PUBLICATION_DISABLED);
  }
  if (ideals.length !== 1) {
    reasons.push(publicTreasuryPendingReasons.ANNUAL_BUDGET_UNAVAILABLE);
  }
  if (!balanceGate.ok || materialReconciliation) {
    reasons.push(publicTreasuryPendingReasons.BALANCE_CONFIRMATION_PENDING);
  }

  let accounting: ReturnType<typeof computeVerifiedAccountingTotals> | null = null;
  try {
    accounting = computeVerifiedAccountingTotals(facts.transactions);
  } catch {
    reasons.push(publicTreasuryPendingReasons.FINANCIAL_RECORD_INCOMPLETE);
  }

  const publicDataReady =
    facts.settings?.breathEnabled === true && accounting !== null && ideals.length === 1;
  const coreReady = reasons.length === 0 && publicDataReady;
  const ideal = coreReady ? ideals[0]! : null;
  const publicIdeal = publicDataReady ? ideals[0]! : null;
  const allocated = accounting ? deriveActiveCommittedFunds(facts.commitments) : 0n;
  const canonicalCashBalance =
    accounting && checkpoint
      ? deriveCheckpointCashBalance(checkpoint, facts.transactions)
      : (accounting?.accountingCashBalance ?? 0n);
  const freeFunds = accounting ? deriveCurrentFreeFunds(canonicalCashBalance, allocated) : 0n;
  const runway =
    coreReady && ideal
      ? latestCurrentRunway({ facts, now, freeFunds, currency: ideal.currency })
      : ({ status: "pending" } as const);
  if (coreReady && runway.status === "pending") {
    reasons.push(publicTreasuryPendingReasons.RUNWAY_UNAVAILABLE);
  }

  const budget =
    publicDataReady && publicIdeal
      ? publicBudget({
          facts,
          year: publicIdeal.periodYear,
          currency: publicIdeal.currency,
          amountMicros: publicIdeal.amountMicros,
          now,
        })
      : {
          status: "pending" as const,
          year: null,
          currency: null,
          annualBudgetAmountMicros: null,
          months: [],
        };

  const lastUpdated =
    coreReady && ideal
      ? maxDate([
          facts.settings?.updatedAt,
          ideal.createdAt,
          ...facts.idealAuditFacts
            .filter((row) => row.entityId === ideal.id)
            .map((row) => row.createdAt),
          latest?.createdAt,
          checkpoint?.createdAt,
          runway.status === "published" ? new Date(runway.asOf) : null,
          ...facts.transactions.flatMap((row) =>
            row.status === "VERIFIED" ? [row.verifiedAt, row.updatedAt] : [],
          ),
          ...facts.commitments
            .filter((row) => row.status === "APPROVED" || row.status === "RELEASED")
            .map((row) => row.updatedAt),
        ])
      : null;

  const transactionOffset = Math.max(0, Math.floor(options.transactionOffset ?? 0));
  const transactionLimit = Math.max(
    1,
    Math.min(
      PUBLIC_TREASURY_TRANSACTION_LIMIT,
      Math.floor(options.transactionLimit ?? PUBLIC_TREASURY_TRANSACTION_LIMIT),
    ),
  );
  let transactions: PublicTreasuryTransaction[] = [];
  let transactionTotal = 0;
  let fundingNeeds: PublicTreasuryFundingNeed[] = [];
  let patrons: PublicTreasuryPatrons = {
    status: "pending",
    totalContributedAmountMicros: null,
    currency: null,
    patrons: [],
    privateSupport: null,
    lastUpdatedAt: null,
  };
  let funds: PublicTreasuryProjection["funds"] = {
    status: "pending",
    reason: reasons[0] ?? "PUBLIC_TREASURY_UNAVAILABLE",
  };
  if (publicDataReady && publicIdeal) {
    try {
      const page = publicTransactions({
        facts,
        currency: publicIdeal.currency,
        offset: transactionOffset,
        limit: transactionLimit,
      });
      transactions = page.rows;
      transactionTotal = page.total;
      fundingNeeds = publicFundingNeeds({ facts, currency: publicIdeal.currency });
      patrons = publicPatrons({ facts, currency: publicIdeal.currency });
    } catch {
      transactions = [];
      fundingNeeds = [];
      patrons = {
        status: "pending",
        totalContributedAmountMicros: null,
        currency: null,
        patrons: [],
        privateSupport: null,
        lastUpdatedAt: null,
      };
    }

    const checkpointAllocation =
      coreReady && checkpoint
        ? computeVirtualFundAllocation({
            canonicalFreeFundsMicros: freeFunds,
            protectedAnnualBudgetMicros: publicIdeal.amountMicros,
          })
        : null;
    const allocationCheckpoint = checkpointAllocation ? checkpoint : null;
    const allocation = coreReady && !checkpoint ? evaluateFundAllocationFacts(facts, now) : null;
    if (checkpointAllocation && allocationCheckpoint) {
      funds = {
        status: "published",
        currency: publicIdeal.currency,
        allocationAsOf: allocationCheckpoint.asOf.toISOString(),
        canonicalFreeFundsMicros: money(freeFunds),
        protectedAnnualBudgetMicros: money(publicIdeal.amountMicros),
        operatingAllocationMicros: money(checkpointAllocation.operatingAllocationMicros),
        developmentAllocationMicros: money(checkpointAllocation.developmentAllocationMicros),
        policyCode: TREASURY_FUND_ALLOCATION_POLICY_CODE,
        policyVersion: TREASURY_FUND_ALLOCATION_POLICY_VERSION,
      };
    } else if (allocation?.status === "available") {
      const amounts = computeVirtualFundAllocation({
        canonicalFreeFundsMicros: allocation.input.canonicalFreeFundsMicros,
        protectedAnnualBudgetMicros: allocation.input.protectedAnnualBudgetMicros,
      });
      funds = {
        status: "published",
        currency: allocation.input.accountingCurrency,
        allocationAsOf: allocation.input.reconciliation.asOfTime.toISOString(),
        canonicalFreeFundsMicros: money(allocation.input.canonicalFreeFundsMicros),
        protectedAnnualBudgetMicros: money(allocation.input.protectedAnnualBudgetMicros),
        operatingAllocationMicros: money(amounts.operatingAllocationMicros),
        developmentAllocationMicros: money(amounts.developmentAllocationMicros),
        policyCode: TREASURY_FUND_ALLOCATION_POLICY_CODE,
        policyVersion: TREASURY_FUND_ALLOCATION_POLICY_VERSION,
      };
    } else {
      funds = {
        status: "pending",
        reason: allocation?.reason ?? reasons[0] ?? "PUBLIC_TREASURY_UNAVAILABLE",
      };
    }
  }

  return {
    schemaVersion: PUBLIC_TREASURY_SCHEMA_VERSION,
    breath: {
      status: coreReady && runway.status === "published" ? "published" : "pending",
      pendingReasons: uniqueReasons(reasons),
      availableAmountMicros: coreReady ? money(freeFunds) : null,
      availableCurrency: publicIdeal?.currency ?? null,
      runway,
      annualBudgetAmountMicros: publicIdeal ? money(publicIdeal.amountMicros) : null,
      annualBudgetCurrency: publicIdeal?.currency ?? null,
      lastUpdatedAt: lastUpdated?.toISOString() ?? null,
    },
    budget,
    transactions,
    transactionPagination: {
      offset: transactionOffset,
      limit: transactionLimit,
      total: transactionTotal,
      hasPrevious: transactionOffset > 0,
      hasNext: transactionOffset + transactions.length < transactionTotal,
    },
    fundingNeeds,
    patrons,
    funds,
  };
}
