import {
  deriveCategoryBudgetAnnual,
  deriveCategoryBudgetMonth,
  type TreasuryCategoryBudgetAnnualSummary,
} from "@/lib/waia-core/treasury/admin/category-budget-truth";
import {
  computeVerifiedAccountingTotals,
  contributionFundedMicros,
  deriveActiveCommittedFunds,
  deriveCurrentFreeFunds,
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
}): PublicTreasuryTransaction[] {
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

  return input.facts.transactions
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
    })
    .slice(0, PUBLIC_TREASURY_TRANSACTION_LIMIT)
    .map((tx) => ({
      occurredAt: tx.occurredAt.toISOString(),
      amountMicros: money(tx.cashEffectMicros!),
      currency: input.currency,
      categoryName: tx.categoryId ? (categoryById.get(tx.categoryId)?.name ?? null) : null,
      categoryGroup: categoryGroup(tx),
      projectName: tx.projectId ? (projectById.get(tx.projectId)?.name ?? null) : null,
      description: tx.publicDescription?.trim() || null,
    }));
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
}): PublicTreasuryBudget {
  try {
    const annual = deriveCategoryBudgetAnnual({
      year: input.year,
      categories: input.facts.categories,
      history: input.facts.categoryBudgetHistory,
      transactions: input.facts.transactions,
    });
    const matching = annual.totals.find((row) => row.currency === input.currency);
    const conflicting = annual.totals.some(
      (row) => row.currency !== input.currency && row.budgetMicros !== 0n,
    );
    if (!matching || conflicting || matching.budgetMicros !== input.amountMicros) {
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
      months: annual.months.map((month) => serializeBudgetMonth(month, input.currency)),
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
  const publicByUser = new Map<string, { displayName: string; amountMicros: bigint }>();
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
    denominator += net;
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
    const userId = attribution?.contributorUserId ?? null;
    const displayName = userId ? profileByUser.get(userId) : undefined;
    if (
      attribution?.status === "ATTRIBUTED" &&
      attribution.consentPublicIdentity &&
      userId &&
      displayName
    ) {
      const current = publicByUser.get(userId) ?? { displayName, amountMicros: 0n };
      current.amountMicros += net;
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
  };
}

export function derivePublicTreasuryProjection(
  facts: PublicTreasuryFacts,
  now: Date = new Date(),
): PublicTreasuryProjection {
  assertFactScope(facts);
  const reasons: PublicTreasuryPendingReason[] = [];
  const ideals = selectApplicablePublicIdeals(facts.idealBudgets, now);
  const latest = latestReconciliation(facts.reconciliations);
  const balanceGate = evaluateBalanceReconciliationGate({
    latest,
    inceptions: facts.inceptions,
    now,
  });
  const materialReconciliation = evaluateMaterialUnresolvedReconciliation(facts.transactions);

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

  const coreReady = reasons.length === 0 && accounting !== null && ideals.length === 1;
  const ideal = coreReady ? ideals[0]! : null;
  const allocated = accounting ? deriveActiveCommittedFunds(facts.commitments) : 0n;
  const freeFunds = accounting
    ? deriveCurrentFreeFunds(accounting.accountingCashBalance, allocated)
    : 0n;
  const runway =
    coreReady && ideal
      ? latestCurrentRunway({ facts, now, freeFunds, currency: ideal.currency })
      : ({ status: "pending" } as const);
  if (coreReady && runway.status === "pending") {
    reasons.push(publicTreasuryPendingReasons.RUNWAY_UNAVAILABLE);
  }

  const budget =
    coreReady && ideal
      ? publicBudget({
          facts,
          year: ideal.periodYear,
          currency: ideal.currency,
          amountMicros: ideal.amountMicros,
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
          runway.status === "published" ? new Date(runway.asOf) : null,
          ...facts.transactions.flatMap((row) =>
            row.status === "VERIFIED" ? [row.verifiedAt, row.updatedAt] : [],
          ),
          ...facts.commitments
            .filter((row) => row.status === "APPROVED" || row.status === "RELEASED")
            .map((row) => row.updatedAt),
        ])
      : null;

  let transactions: PublicTreasuryTransaction[] = [];
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
  if (coreReady && ideal) {
    try {
      transactions = publicTransactions({ facts, currency: ideal.currency });
      fundingNeeds = publicFundingNeeds({ facts, currency: ideal.currency });
      patrons = publicPatrons({ facts, currency: ideal.currency });
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

    const allocation = evaluateFundAllocationFacts(facts, now);
    if (allocation.status === "available") {
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
      funds = { status: "pending", reason: allocation.reason };
    }
  }

  return {
    schemaVersion: PUBLIC_TREASURY_SCHEMA_VERSION,
    breath: {
      status: coreReady && runway.status === "published" ? "published" : "pending",
      pendingReasons: uniqueReasons(reasons),
      availableAmountMicros: coreReady ? money(freeFunds) : null,
      availableCurrency: ideal?.currency ?? null,
      runway,
      annualBudgetAmountMicros: ideal ? money(ideal.amountMicros) : null,
      annualBudgetCurrency: ideal?.currency ?? null,
      lastUpdatedAt: lastUpdated?.toISOString() ?? null,
    },
    budget,
    transactions,
    fundingNeeds,
    patrons,
    funds,
  };
}
