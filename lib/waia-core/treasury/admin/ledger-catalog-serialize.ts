import type {
  TreasuryAccountRecord,
  TreasuryCategoryRecord,
  TreasuryCounterpartyRecord,
  TreasuryProjectRecord,
} from "@/lib/waia-core/treasury/admin/ledger-catalog-types";

function iso(value: Date): string {
  return value.toISOString();
}

export function serializeCounterpartySummary(row: TreasuryCounterpartyRecord) {
  return {
    id: row.id,
    displayName: row.displayName,
    waiaUsername: row.waiaUsername,
    isActive: row.isActive,
  };
}

export function serializeCounterpartyDetail(row: TreasuryCounterpartyRecord) {
  return {
    ...serializeCounterpartySummary(row),
    organizationId: row.organizationId,
    waiaUserId: row.waiaUserId,
    websiteUrl: row.websiteUrl,
    email: row.email,
    phone: row.phone,
    paymentInstructions: row.paymentInstructions,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function serializeAccountSummary(row: TreasuryAccountRecord) {
  return {
    id: row.id,
    displayName: row.displayName,
    kind: row.kind,
    currency: row.currency,
    network: row.network,
    isActive: row.isActive,
  };
}

export function serializeAccountDetail(row: TreasuryAccountRecord) {
  return {
    ...serializeAccountSummary(row),
    organizationId: row.organizationId,
    address: row.address,
    maskedRequisites: row.maskedRequisites,
    watchedAddressId: row.watchedAddressId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function serializeCategory(row: TreasuryCategoryRecord) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    description: row.description,
    monthlyBudgetMicros: row.monthlyBudgetMicros.toString(10),
    currency: row.currency,
    isActive: row.isActive,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function serializeProject(row: TreasuryProjectRecord) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    isActive: row.isActive,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
