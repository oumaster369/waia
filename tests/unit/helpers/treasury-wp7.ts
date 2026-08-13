import {
  TREASURY_USDT_V1_NETWORK,
  TREASURY_USDT_V1_TOKEN_CONTRACT,
  createContributionShareEngine,
  createMemoryContributionShareFactsRepository,
  type TreasuryAttributionRecord,
} from "@/lib/waia-core/treasury";
import type { TreasuryAdminAttribution } from "@/lib/waia-core/treasury/admin/catalog-types";
import type { TreasuryAdminServices } from "@/lib/waia-core/treasury/admin/services";
import type { TreasuryTransactionRecord } from "@/lib/waia-core/treasury/types";
import { NOW, ORG_A, USER_A, createWp6Bundle, seedTx } from "@/tests/unit/helpers/treasury-wp6";

export { ctxA, ctxB, ORG_A, ORG_B, USER_A } from "@/tests/unit/helpers/treasury-wp2";
export {
  BUDGET_A,
  COMMIT_A,
  NOW,
  PLAN_A,
  createWp6Bundle,
  seedBudget,
  seedCommitment,
  seedNeed,
  seedPlan,
  seedPublishableControl,
  seedTx,
} from "@/tests/unit/helpers/treasury-wp6";

export const USER_B = "dddddddd-dddd-4ddd-8ddd-ddddddddddd4";
export const ATTR_A = "attraaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

export function createWp7Bundle() {
  const bundle = createWp6Bundle();
  const facts = createMemoryContributionShareFactsRepository({
    treasury: bundle.services.domain.repository,
    catalog: bundle.services.catalogRepo,
  });
  const engine = createContributionShareEngine(facts);
  return { ...bundle, facts, engine };
}

export async function seedQualifyingContribution(
  services: TreasuryAdminServices,
  input: Partial<TreasuryTransactionRecord> & Pick<TreasuryTransactionRecord, "id">,
) {
  return seedTx(services, {
    kind: "CONTRIBUTION",
    nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
    accountingAmountMicros: 1_000_000n,
    cashEffectMicros: 1_000_000n,
    ...input,
    id: input.id,
    status: input.status ?? "VERIFIED",
    direction: input.direction ?? "INFLOW",
  });
}

export async function seedWatcherQualifyingContribution(
  services: TreasuryAdminServices,
  input: Partial<TreasuryTransactionRecord> & Pick<TreasuryTransactionRecord, "id">,
) {
  return seedQualifyingContribution(services, {
    provenance: "WATCHER",
    canonicalNetwork: TREASURY_USDT_V1_NETWORK,
    canonicalTokenContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
    nativeContract: TREASURY_USDT_V1_TOKEN_CONTRACT,
    canonicalTxHash: `hash-${input.id}`,
    canonicalTransferIndex: 0,
    txHash: `hash-${input.id}`,
    ...input,
    id: input.id,
  });
}

export async function seedOpenAttribution(
  services: TreasuryAdminServices,
  input: Partial<TreasuryAdminAttribution> &
    Pick<TreasuryAdminAttribution, "id" | "transactionId" | "status">,
) {
  const record: TreasuryAdminAttribution = {
    organizationId: input.organizationId ?? ORG_A,
    attributionMethod: input.attributionMethod ?? "MANUAL",
    consentPublicIdentity: input.consentPublicIdentity ?? false,
    note: input.note ?? null,
    attributedByUserId: input.attributedByUserId ?? USER_A,
    attributedAt:
      input.attributedAt ?? (input.status === "ATTRIBUTED" ? (input.createdAt ?? NOW) : null),
    revokedAt: input.revokedAt ?? null,
    createdAt: input.createdAt ?? NOW,
    contributorUserId: input.contributorUserId ?? null,
    ...input,
  };
  await services.catalogRepo.insertAdminAttribution(record);
  return record;
}

export async function seedDomainAttribution(
  services: TreasuryAdminServices,
  input: TreasuryAttributionRecord,
) {
  await services.domain.repository.insertAttribution(input);
  return input;
}
