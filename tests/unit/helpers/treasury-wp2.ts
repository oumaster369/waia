import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import type { AuditLogInput } from "@/lib/waia-core/types";
import {
  USDT_NOMINAL_USD_POLICY_V1,
  createMemoryTreasuryDomainServices,
  type TreasuryActorContext,
  type TreasuryTransactionRecord,
} from "@/lib/waia-core/treasury";

export const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
export const USER_A = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";

export const actorA: TreasuryActorContext = { actorType: "user", actorUserId: USER_A };
export const ctxA: OrgContext = requireOrgContext(ORG_A);
export const ctxB: OrgContext = requireOrgContext(ORG_B);

export function createAuditedTreasuryServices() {
  const audits: AuditLogInput[] = [];
  const services = createMemoryTreasuryDomainServices(async (input) => {
    audits.push(input);
    return `audit-${audits.length}`;
  });
  return { services, audits };
}

export function usdtAmount(atomic: bigint) {
  return {
    nativeAmountAtomic: atomic,
    nativeDecimals: 6,
    nativeAsset: "USDT" as const,
    accountingAmountMicros: atomic,
    accountingDenominationPolicy: USDT_NOMINAL_USD_POLICY_V1,
  };
}

export async function seedWatcherTransaction(
  repository: ReturnType<typeof createMemoryTreasuryDomainServices>["repository"],
  input: {
    id: string;
    organizationId: string;
    status: TreasuryTransactionRecord["status"];
    direction: TreasuryTransactionRecord["direction"];
    kind?: TreasuryTransactionRecord["kind"];
    accountingAmountMicros?: bigint;
    cashEffectMicros?: bigint | null;
  },
) {
  const money = usdtAmount(input.accountingAmountMicros ?? 1_000_000n);
  const now = new Date("2026-08-01T00:00:00.000Z");
  const record: TreasuryTransactionRecord = {
    id: input.id,
    organizationId: input.organizationId,
    status: input.status,
    detailPublication: "PRIVATE",
    provenance: "WATCHER",
    canonicalNetwork: "TRC-20",
    canonicalTokenContract: "TUSDT",
    canonicalTxHash: `hash-${input.id}`,
    canonicalTransferIndex: 0,
    direction: input.direction,
    kind: input.kind ?? null,
    fundBucketCode: "UNASSIGNED",
    nativeAmountAtomic: money.nativeAmountAtomic,
    nativeDecimals: money.nativeDecimals,
    nativeAsset: money.nativeAsset,
    nativeContract: "TUSDT",
    accountingAmountMicros: money.accountingAmountMicros,
    accountingDenominationPolicy: money.accountingDenominationPolicy,
    cashEffectMicros: input.cashEffectMicros ?? money.accountingAmountMicros,
    counterpartyIsInternal: input.direction === "INTERNAL",
    occurredAt: now,
    purpose: "seed",
    category: null,
    counterpartyDisplay: null,
    publishCounterparty: false,
    projectModule: null,
    milestoneStage: null,
    budgetId: null,
    fundingNeedId: null,
    description: null,
    internalNotes: null,
    publicDescription: null,
    txHash: `hash-${input.id}`,
    correctsTransactionId: null,
    duplicateOfTransactionId: null,
    detailSupersededById: null,
    ledgerInceptionId: null,
    verifiedAt: null,
    verifiedByUserId: null,
    detailPublishedAt: null,
    detailPublishedByUserId: null,
    latestRevisionId: null,
    recordContentDigest: "seed",
    createdByUserId: USER_A,
    createdAt: now,
    updatedAt: now,
  };
  await repository.insertTransaction(record);
  return record;
}

export async function seedObservation(
  repository: ReturnType<typeof createMemoryTreasuryDomainServices>["repository"],
  input: {
    id: string;
    organizationId: string;
    transactionId: string;
    observationStatus: "OBSERVED" | "CONFIRMED" | "DROPPED";
    confirmationsObserved: number;
    confirmationsRequired?: number;
  },
) {
  await repository.insertObservation({
    id: input.id,
    organizationId: input.organizationId,
    observationStatus: input.observationStatus,
    confirmationsObserved: input.confirmationsObserved,
    confirmationsRequired: input.confirmationsRequired ?? 20,
  });
  await repository.insertObservationLink({
    id: `${input.id}-link`,
    organizationId: input.organizationId,
    transactionId: input.transactionId,
    observationId: input.id,
    observationRole: "PRIMARY",
  });
}
