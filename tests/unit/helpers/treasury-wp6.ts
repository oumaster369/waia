import type { AuditLogInput } from "@/lib/waia-core/types";
import { createMemoryTreasuryAdminServices } from "@/lib/waia-core/treasury/admin/services";
import type { TreasuryAdminServices } from "@/lib/waia-core/treasury/admin/services";
import type {
  TreasuryBudgetRecord,
  TreasuryFundingNeedRecord,
  TreasuryIdealBudgetRecord,
  TreasuryRunwayPlanRecord,
} from "@/lib/waia-core/treasury/admin/catalog-types";
import type {
  TreasuryCommitmentRecord,
  TreasuryInceptionRecord,
  TreasuryTransactionRecord,
} from "@/lib/waia-core/treasury/types";
import type { TreasuryBalanceReconciliationRecord } from "@/lib/waia-core/treasury/watcher/types";
import { BREATH_RECON_MAX_AGE_MS } from "@/lib/waia-core/treasury/breath/types";
import { ctxA, ORG_A, USER_A, usdtAmount } from "@/tests/unit/helpers/treasury-wp2";
import { INCEPTION_A } from "@/tests/unit/helpers/treasury-wp3";

export { ctxA, ORG_A, ORG_B, USER_A } from "@/tests/unit/helpers/treasury-wp2";
export { INCEPTION_A };

export const NOW = new Date("2026-08-13T12:00:00.000Z");
export const BUDGET_A = "budaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const BUDGET_B = "budbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
export const NEED_A = "neadaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const NEED_B = "neadbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
export const IDEAL_A = "ideaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const PLAN_A = "planaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const PLAN_B = "planbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
export const RECON_A = "reconaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const COMMIT_A = "commaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

export function createWp6Clock(initial: Date = NOW) {
  let current = initial;
  return {
    now: () => current,
    set(next: Date) {
      current = next;
    },
  };
}

export function createWp6Bundle(clock = createWp6Clock()) {
  const audits: AuditLogInput[] = [];
  const services = createMemoryTreasuryAdminServices(
    async (input) => {
      audits.push(input);
      return `audit-${audits.length}`;
    },
    { now: clock.now },
  );
  return { services, audits, clock };
}

export async function seedTx(
  services: TreasuryAdminServices,
  input: Partial<TreasuryTransactionRecord> &
    Pick<TreasuryTransactionRecord, "id" | "status" | "direction">,
) {
  const money = usdtAmount(input.accountingAmountMicros ?? 1_000_000n);
  const occurredAt = input.occurredAt ?? NOW;
  const record: TreasuryTransactionRecord = {
    id: input.id,
    organizationId: input.organizationId ?? ORG_A,
    status: input.status,
    detailPublication: input.detailPublication ?? "PRIVATE",
    provenance: input.provenance ?? "MANUAL",
    canonicalNetwork: input.canonicalNetwork ?? null,
    canonicalTokenContract: input.canonicalTokenContract ?? null,
    canonicalTxHash: input.canonicalTxHash ?? null,
    canonicalTransferIndex: input.canonicalTransferIndex ?? null,
    direction: input.direction,
    kind: input.kind ?? "CONTRIBUTION",
    fundBucketCode: input.fundBucketCode ?? "UNASSIGNED",
    nativeAmountAtomic: input.nativeAmountAtomic ?? money.nativeAmountAtomic,
    nativeDecimals: input.nativeDecimals ?? money.nativeDecimals,
    nativeAsset: input.nativeAsset ?? money.nativeAsset,
    nativeContract: input.nativeContract ?? null,
    accountingAmountMicros: input.accountingAmountMicros ?? money.accountingAmountMicros,
    accountingDenominationPolicy:
      input.accountingDenominationPolicy ?? money.accountingDenominationPolicy,
    cashEffectMicros:
      input.cashEffectMicros === undefined ? money.accountingAmountMicros : input.cashEffectMicros,
    counterpartyIsInternal: input.counterpartyIsInternal ?? input.direction === "INTERNAL",
    occurredAt,
    purpose: input.purpose ?? "seed",
    category: input.category ?? null,
    counterpartyDisplay: input.counterpartyDisplay ?? null,
    publishCounterparty: input.publishCounterparty ?? false,
    projectModule: input.projectModule ?? null,
    milestoneStage: input.milestoneStage ?? null,
    budgetId: input.budgetId ?? null,
    fundingNeedId: input.fundingNeedId ?? null,
    description: input.description ?? null,
    internalNotes: input.internalNotes ?? "SECRET_NOTE",
    publicDescription: input.publicDescription ?? null,
    txHash: input.txHash ?? null,
    correctsTransactionId: input.correctsTransactionId ?? null,
    duplicateOfTransactionId: input.duplicateOfTransactionId ?? null,
    detailSupersededById: input.detailSupersededById ?? null,
    ledgerInceptionId: input.ledgerInceptionId ?? null,
    verifiedAt: input.verifiedAt ?? (input.status === "VERIFIED" ? occurredAt : null),
    verifiedByUserId: input.verifiedByUserId ?? (input.status === "VERIFIED" ? USER_A : null),
    detailPublishedAt: input.detailPublishedAt ?? null,
    detailPublishedByUserId: input.detailPublishedByUserId ?? null,
    latestRevisionId: input.latestRevisionId ?? null,
    recordContentDigest: input.recordContentDigest ?? `digest-${input.id}`,
    createdByUserId: input.createdByUserId ?? USER_A,
    createdAt: input.createdAt ?? occurredAt,
    updatedAt: input.updatedAt ?? occurredAt,
  };
  await services.domain.repository.insertTransaction(record);
  return record;
}

export async function seedCommitment(
  services: TreasuryAdminServices,
  input: Partial<TreasuryCommitmentRecord> & Pick<TreasuryCommitmentRecord, "id" | "status">,
) {
  const record: TreasuryCommitmentRecord = {
    id: input.id,
    organizationId: input.organizationId ?? ORG_A,
    budgetId: input.budgetId ?? null,
    amountMicros: input.amountMicros ?? 1_000_000n,
    currency: input.currency ?? "USD",
    purpose: input.purpose ?? "seed",
    counterpartyDisplay: input.counterpartyDisplay ?? null,
    publishCounterparty: input.publishCounterparty ?? false,
    detailPublication: input.detailPublication ?? "PRIVATE",
    expectedAt: input.expectedAt ?? null,
    effectiveFrom: input.effectiveFrom ?? NOW,
    status: input.status,
    evidenceObjectId: input.evidenceObjectId ?? null,
    createdByUserId: input.createdByUserId ?? USER_A,
    approvedByUserId: input.approvedByUserId ?? null,
    approvedAt: input.approvedAt ?? null,
    releasedByUserId: input.releasedByUserId ?? null,
    releasedAt: input.releasedAt ?? null,
    fulfilledByUserId: input.fulfilledByUserId ?? null,
    fulfilledAt: input.fulfilledAt ?? null,
    cancelledByUserId: input.cancelledByUserId ?? null,
    cancelledAt: input.cancelledAt ?? null,
    fulfillsTransactionId: input.fulfillsTransactionId ?? null,
    recordContentDigest: input.recordContentDigest ?? `commit-${input.id}`,
    createdAt: input.createdAt ?? NOW,
    updatedAt: input.updatedAt ?? NOW,
  };
  await services.domain.repository.insertCommitment(record);
  return record;
}

export async function seedBudget(
  services: TreasuryAdminServices,
  input: Partial<TreasuryBudgetRecord> & Pick<TreasuryBudgetRecord, "id">,
) {
  const record: TreasuryBudgetRecord = {
    id: input.id,
    organizationId: input.organizationId ?? ORG_A,
    code: input.code ?? "CORE",
    title: input.title ?? "Core",
    periodStart: input.periodStart ?? "2026-01-01",
    periodEnd: input.periodEnd ?? "2026-12-31",
    currency: input.currency ?? "USD",
    plannedAmountMicros: input.plannedAmountMicros ?? 10_000_000n,
    status: input.status ?? "ACTIVE",
    isPublic: input.isPublic ?? true,
    notes: input.notes ?? null,
    createdAt: input.createdAt ?? NOW,
    updatedAt: input.updatedAt ?? NOW,
  };
  await services.catalogRepo.insertBudget(record);
  return record;
}

export async function seedNeed(
  services: TreasuryAdminServices,
  input: Partial<TreasuryFundingNeedRecord> & Pick<TreasuryFundingNeedRecord, "id">,
) {
  const record: TreasuryFundingNeedRecord = {
    id: input.id,
    organizationId: input.organizationId ?? ORG_A,
    title: input.title ?? "Need",
    publicExplanation: input.publicExplanation ?? "public",
    targetStage: input.targetStage ?? null,
    requiredAmountMicros: input.requiredAmountMicros ?? 8_000_000n,
    currency: input.currency ?? "USD",
    status: input.status ?? "OPEN",
    isPublic: input.isPublic ?? true,
    budgetId: input.budgetId ?? null,
    createdAt: input.createdAt ?? NOW,
    updatedAt: input.updatedAt ?? NOW,
  };
  await services.catalogRepo.insertFundingNeed(record);
  return record;
}

export async function seedIdeal(
  services: TreasuryAdminServices,
  input: Partial<TreasuryIdealBudgetRecord> & Pick<TreasuryIdealBudgetRecord, "id">,
) {
  const record: TreasuryIdealBudgetRecord = {
    id: input.id,
    organizationId: input.organizationId ?? ORG_A,
    periodYear: input.periodYear ?? 2026,
    currency: input.currency ?? "USD",
    amountMicros: input.amountMicros ?? 42_000_000n,
    effectiveFrom: input.effectiveFrom ?? new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: input.effectiveTo ?? new Date("2026-12-31T23:59:59.000Z"),
    status: input.status ?? "ACTIVE",
    publicationState: input.publicationState ?? "PUBLIC",
    createdByUserId: input.createdByUserId ?? USER_A,
    approvedByUserId: input.approvedByUserId ?? USER_A,
    createdAt: input.createdAt ?? NOW,
  };
  await services.catalogRepo.insertIdealBudget(record);
  return record;
}

export async function seedPlan(
  services: TreasuryAdminServices,
  input: Partial<TreasuryRunwayPlanRecord> & Pick<TreasuryRunwayPlanRecord, "id">,
) {
  const record: TreasuryRunwayPlanRecord = {
    id: input.id,
    organizationId: input.organizationId ?? ORG_A,
    method: input.method ?? "APPROVED_PLANNED_BURN",
    currency: input.currency ?? "USD",
    dailyBurnMicros: input.dailyBurnMicros ?? 1_000_000n,
    effectiveFrom: input.effectiveFrom ?? new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: input.effectiveTo ?? null,
    status: input.status ?? "ACTIVE",
    createdByUserId: input.createdByUserId ?? USER_A,
    approvedByUserId: input.approvedByUserId ?? USER_A,
    createdAt: input.createdAt ?? NOW,
  };
  await services.catalogRepo.insertRunwayPlan(record);
  return record;
}

export async function seedInception(
  services: TreasuryAdminServices,
  input: Partial<TreasuryInceptionRecord> = {},
) {
  const record: TreasuryInceptionRecord = {
    id: input.id ?? INCEPTION_A,
    organizationId: input.organizationId ?? ORG_A,
    network: input.network ?? "TRC-20",
    tokenContract: input.tokenContract ?? "TUSDT",
    assetCode: input.assetCode ?? "USDT",
    inceptionBlock: input.inceptionBlock ?? "1",
    inceptionBlockHash: input.inceptionBlockHash ?? null,
    inceptionTime: input.inceptionTime ?? NOW,
    openingBalanceTransactionId: input.openingBalanceTransactionId ?? "open-1",
    watcherStartBlock: input.watcherStartBlock ?? "1",
    evidenceObjectId: input.evidenceObjectId ?? null,
    status: input.status ?? "ACTIVE",
    createdByUserId: input.createdByUserId ?? USER_A,
    approvedByUserId: input.approvedByUserId ?? USER_A,
    createdAt: input.createdAt ?? NOW,
  };
  await services.domain.repository.insertInception(record);
  return record;
}

export async function seedRecon(
  services: TreasuryAdminServices,
  input: Partial<TreasuryBalanceReconciliationRecord> = {},
) {
  const observed = input.observedOnchainBalanceAtomic ?? 0n;
  const accounting = input.accountingCashBalanceMicros ?? 0n;
  const record: TreasuryBalanceReconciliationRecord = {
    id: input.id ?? RECON_A,
    organizationId: input.organizationId ?? ORG_A,
    ledgerInceptionId:
      input.ledgerInceptionId === undefined ? INCEPTION_A : input.ledgerInceptionId,
    asOfBlock: input.asOfBlock ?? "10",
    asOfTime: input.asOfTime ?? NOW,
    observedOnchainBalanceAtomic: observed,
    accountingCashBalanceMicros: accounting,
    deltaMicros: input.deltaMicros === undefined ? observed - accounting : input.deltaMicros,
    explainedPendingMicros: input.explainedPendingMicros ?? 0n,
    unexplainedResidualMicros: input.unexplainedResidualMicros ?? 0n,
    status: input.status ?? "MATCHED",
    toleranceMicros: input.toleranceMicros ?? 0n,
    evidenceObjectId: input.evidenceObjectId ?? null,
    notes: input.notes ?? "internal recon notes",
    createdBy: input.createdBy ?? "watcher",
    createdAt: input.createdAt ?? NOW,
  };
  await services.watcher.insertBalanceReconciliation(record);
  return record;
}

export async function seedSettings(
  services: TreasuryAdminServices,
  patch: Partial<{
    breathEnabled: boolean;
    stageLabel: string | null;
    workSummary: string | null;
    methodologyNote: string;
    recentActivityLimit: number;
    updatedAt: Date;
  }> = {},
) {
  await services.catalogRepo.upsertPublicationSettings({
    organizationId: ORG_A,
    breathEnabled: patch.breathEnabled ?? true,
    stageLabel: patch.stageLabel ?? "Foundation",
    workSummary: patch.workSummary ?? "Building the twin",
    methodologyNote:
      patch.methodologyNote ?? "resources.spent = consolidated treasury cash outflow",
    recentActivityLimit: patch.recentActivityLimit ?? 5,
    updatedByUserId: USER_A,
    updatedAt: patch.updatedAt ?? NOW,
  });
}

export async function seedPublishableControl(services: TreasuryAdminServices) {
  await seedSettings(services);
  await seedIdeal(services, { id: IDEAL_A });
  await seedInception(services);
  await seedRecon(services, {
    observedOnchainBalanceAtomic: 0n,
    accountingCashBalanceMicros: 0n,
    deltaMicros: 0n,
    unexplainedResidualMicros: 0n,
    status: "MATCHED",
    createdAt: NOW,
  });
}

export function exactlyTenMinutesAgo(now: Date): Date {
  return new Date(now.getTime() - BREATH_RECON_MAX_AGE_MS);
}

export function staleReconTime(now: Date): Date {
  return new Date(now.getTime() - BREATH_RECON_MAX_AGE_MS - 1);
}

export { ctxA as orgContext };
