import type { TreasuryCategoryRecord, TreasuryProjectRecord } from "@/lib/waia-core/treasury/admin/ledger-catalog-types";
import {
  computeVerifiedAccountingTotals,
  deriveActiveCommittedFunds,
  deriveCurrentFreeFunds,
} from "@/lib/waia-core/treasury/breath/accounting";
import { computeRunwayEndsAt, computeRunwayInputDigest } from "@/lib/waia-core/treasury/breath/runway";
import type { PublicTreasuryFacts } from "@/lib/waia-core/treasury/public/repository.types";
import {
  NOW,
  ORG_A,
  PLAN_A,
  USER_A,
  createWp6Bundle,
  seedIdeal,
  seedInception,
  seedNeed,
  seedPlan,
  seedRecon,
  seedSettings,
  seedTx,
} from "@/tests/unit/helpers/treasury-wp6";
import {
  USER_B,
  seedOpenAttribution,
  seedQualifyingContribution,
} from "@/tests/unit/helpers/treasury-wp7";

export { NOW, ORG_A, USER_A, USER_B };

const context = { organizationId: ORG_A };

export async function createPublishedPublicTreasuryFacts(): Promise<PublicTreasuryFacts> {
  const { services } = createWp6Bundle();
  await seedSettings(services, { updatedAt: NOW });
  await seedIdeal(services, {
    id: "61700000-0000-4000-8000-000000000001",
    amountMicros: 120_000_000n,
    periodYear: 2026,
    currency: "USD",
    createdAt: NOW,
  });
  const plan = await seedPlan(services, {
    id: PLAN_A,
    dailyBurnMicros: 1_000_000n,
    currency: "USD",
    createdAt: NOW,
  });

  const category: TreasuryCategoryRecord = {
    id: "61700000-0000-4000-8000-000000000002",
    organizationId: ORG_A,
    code: "DEVELOPMENT",
    name: "Development",
    groupName: "Development",
    description: "Product development",
    monthlyBudgetMicros: 10_000_000n,
    currency: "USD",
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
  await services.ledgerCatalogRepo.categories.insertWithBudget(category, {
    id: "61700000-0000-4000-8000-000000000003",
    organizationId: ORG_A,
    categoryId: category.id,
    effectiveMonth: "2026-01-01",
    groupName: "Development",
    monthlyBudgetMicros: 10_000_000n,
    currency: "USD",
    createdAt: NOW,
    updatedAt: NOW,
  });
  const project: TreasuryProjectRecord = {
    id: "61700000-0000-4000-8000-000000000004",
    organizationId: ORG_A,
    name: "WAIA Core",
    description: "Core platform",
    startsOn: "2026-01-01",
    endsOn: null,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
  await services.ledgerCatalogRepo.projects.insert(project);

  await seedNeed(services, {
    id: "61700000-0000-4000-8000-000000000005",
    title: "Core development",
    publicExplanation: "Fund the next development milestone.",
    targetStage: "Foundation",
    requiredAmountMicros: 50_000_000n,
    currency: "USD",
    status: "PARTIALLY_FUNDED",
    isPublic: true,
    createdAt: NOW,
    updatedAt: NOW,
  });

  await seedQualifyingContribution(services, {
    id: "61700000-0000-4000-8000-000000000006",
    accountingAmountMicros: 20_000_000n,
    cashEffectMicros: 20_000_000n,
    fundingNeedId: "61700000-0000-4000-8000-000000000005",
    occurredAt: new Date("2026-08-11T12:00:00.000Z"),
  });
  await seedOpenAttribution(services, {
    id: "61700000-0000-4000-8000-000000000007",
    transactionId: "61700000-0000-4000-8000-000000000006",
    status: "ATTRIBUTED",
    contributorUserId: USER_A,
    consentPublicIdentity: true,
    note: "PRIVATE alice@example.com",
    createdAt: NOW,
  });
  await seedQualifyingContribution(services, {
    id: "61700000-0000-4000-8000-000000000008",
    accountingAmountMicros: 10_000_000n,
    cashEffectMicros: 10_000_000n,
    occurredAt: new Date("2026-08-12T12:00:00.000Z"),
  });
  await seedOpenAttribution(services, {
    id: "61700000-0000-4000-8000-000000000009",
    transactionId: "61700000-0000-4000-8000-000000000008",
    status: "ANONYMOUS",
    consentPublicIdentity: false,
    note: "PRIVATE anonymous note",
    createdAt: NOW,
  });
  await seedTx(services, {
    id: "61700000-0000-4000-8000-000000000010",
    status: "VERIFIED",
    direction: "OUTFLOW",
    kind: "EXPENSE",
    detailPublication: "DETAIL_PUBLIC",
    categoryId: category.id,
    projectId: project.id,
    accountingAmountMicros: 5_000_000n,
    cashEffectMicros: -5_000_000n,
    occurredAt: NOW,
    publicDescription: "Public engineering expense",
    internalNotes: "PRIVATE bank account and approval notes",
    counterpartyDisplay: "PRIVATE supplier name",
    publishCounterparty: false,
  });

  await seedInception(services, { createdAt: NOW });
  await seedRecon(services, {
    observedOnchainBalanceAtomic: 25_000_000n,
    accountingCashBalanceMicros: 25_000_000n,
    deltaMicros: 0n,
    unexplainedResidualMicros: 0n,
    status: "MATCHED",
    createdAt: NOW,
  });

  const [
    settings,
    transactions,
    commitments,
    fundingNeeds,
    idealBudgets,
    runwayPlans,
    reconciliations,
    inceptions,
    categories,
    categoryBudgetHistory,
    projects,
    attributions,
  ] = await Promise.all([
    services.catalogRepo.getPublicationSettings(context),
    services.domain.repository.listTransactions(context),
    services.domain.repository.listCommitments(context),
    services.catalogRepo.listFundingNeeds(context),
    services.catalogRepo.listIdealBudgets(context),
    services.catalogRepo.listRunwayPlans(context),
    services.watcher.listBalanceReconciliations(context),
    services.domain.repository.listInceptions(context),
    services.ledgerCatalogRepo.categories.list(context, { limit: 100 }),
    services.ledgerCatalogRepo.categoryBudgetHistory.list(context),
    services.ledgerCatalogRepo.projects.list(context, { limit: 100 }),
    services.catalogRepo.listOrgAttributions(context),
  ]);
  const accounting = computeVerifiedAccountingTotals(transactions);
  const freeFunds = deriveCurrentFreeFunds(
    accounting.accountingCashBalance,
    deriveActiveCommittedFunds(commitments),
  );
  const inputDigest = computeRunwayInputDigest({
    verified: transactions,
    commitments,
    plan,
    freeFundsAtAsOfMicros: freeFunds,
  });

  return {
    organizationId: ORG_A,
    settings,
    transactions,
    commitments,
    fundingNeeds,
    idealBudgets,
    runwayPlans,
    runwaySnapshots: [
      {
        id: "61700000-0000-4000-8000-000000000011",
        organizationId: ORG_A,
        runwayPlanId: plan.id,
        runwayAsOf: NOW,
        freeFundsAtAsOfMicros: freeFunds,
        approvedDailyBurnMicros: plan.dailyBurnMicros,
        endsAt: computeRunwayEndsAt({
          runwayAsOf: NOW,
          freeFundsAtAsOfMicros: freeFunds,
          approvedDailyBurnMicros: plan.dailyBurnMicros,
        }),
        inputDigest,
        createdAt: NOW,
      },
    ],
    reconciliations,
    inceptions,
    categories,
    categoryBudgetHistory,
    projects,
    attributions,
    profiles: [
      { userId: USER_A, displayName: "Alice", updatedAt: NOW },
      { userId: USER_B, displayName: "Bob", updatedAt: NOW },
    ],
    idealAuditFacts: [],
  };
}
