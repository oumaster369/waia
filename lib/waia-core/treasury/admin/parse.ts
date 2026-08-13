import {
  treasuryBudgetStatusEnum,
  treasuryEvidenceKindEnum,
  treasuryEvidenceVisibilityEnum,
  treasuryFundingNeedStatusEnum,
  treasuryTxDirectionEnum,
  treasuryTxKindEnum,
  treasuryTxStatusEnum,
  treasuryDetailPublicationEnum,
} from "@/db/core-enums";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import {
  parseDecimalBigint,
  parsePositiveDecimalBigint,
} from "@/lib/waia-core/treasury/admin/money";
import type { TreasurySemanticPatch } from "@/lib/waia-core/treasury/types";

const WATCHER_ENABLE_KEYS = [
  "TREASURY_WATCHER_ENABLED",
  "treasury_watcher_enabled",
  "watcher_enabled",
  "enable_watcher",
  "enableWatcher",
] as const;

const BUDGET_AGGREGATE_KEYS = [
  "funded",
  "committed",
  "spent",
  "remaining",
  "funded_amount_micros",
  "fundedAmountMicros",
  "committed_amount_micros",
  "committedAmountMicros",
  "spent_amount_micros",
  "spentAmountMicros",
  "remaining_amount_micros",
  "remainingAmountMicros",
] as const;

const FUNDING_FUNDED_KEYS = [
  "funded",
  "funded_amount",
  "fundedAmount",
  "funded_amount_micros",
  "fundedAmountMicros",
] as const;

const WATCHED_IMMUTABLE_KEYS = [
  "network",
  "address",
  "token_contract",
  "tokenContract",
  "asset_code",
  "assetCode",
] as const;

const CUSTODY_KEYS = [
  "private_key",
  "privateKey",
  "secret",
  "mnemonic",
  "seed",
  "signing_key",
  "signingKey",
] as const;

const EVIDENCE_CLIENT_STORAGE_AUTHORITY_KEYS = [
  "object_key",
  "objectKey",
  "storage_backend",
  "storageBackend",
  "byte_size",
  "byteSize",
  "public_url",
  "publicUrl",
  "url",
  "r2_url",
  "r2Url",
] as const;

export function asObject(value: unknown, label = "body"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TreasuryValidationError("INVALID_BODY", `${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TreasuryValidationError("INVALID_BODY", `${label} is required`);
  }
  return value.trim();
}

export function optionalString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new TreasuryValidationError("INVALID_BODY", `${label} must be a string`);
  }
  return value;
}

export function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TreasuryValidationError("INVALID_BODY", `${label} must be a boolean`);
  }
  return value;
}

export function requireIsoDate(value: unknown, label: string): Date {
  const raw = requireString(value, label);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new TreasuryValidationError("INVALID_BODY", `${label} must be an ISO-8601 timestamp`);
  }
  return parsed;
}

export function requireInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TreasuryValidationError("INVALID_BODY", `${label} must be an integer`);
  }
  return value;
}

export function parseBoundedLimit(raw: unknown, fallback: number, max: number): number {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : raw;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
    throw new TreasuryValidationError("INVALID_PAGINATION", "limit must be a positive integer");
  }
  return Math.min(n, max);
}

export function parseBoundedOffset(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return 0;
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : raw;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
    throw new TreasuryValidationError(
      "INVALID_PAGINATION",
      "offset must be a non-negative integer",
    );
  }
  return n;
}

export function rejectKeys(body: Record<string, unknown>, keys: readonly string[], code: string) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined) {
      throw new TreasuryValidationError(code, `${key} is not an accepted admin-maintained field`);
    }
  }
}

export function rejectWatcherEnablement(body: Record<string, unknown>) {
  rejectKeys(body, WATCHER_ENABLE_KEYS, "WATCHER_ENABLE_FORBIDDEN");
}

export function rejectBudgetAggregates(body: Record<string, unknown>) {
  rejectKeys(body, BUDGET_AGGREGATE_KEYS, "AGGREGATE_NOT_AUTHORITY");
}

export function rejectFundedAmount(body: Record<string, unknown>) {
  rejectKeys(body, FUNDING_FUNDED_KEYS, "FUNDED_AMOUNT_NOT_AUTHORITY");
}

export function rejectWatchedImmutableIdentity(body: Record<string, unknown>) {
  rejectKeys(body, WATCHED_IMMUTABLE_KEYS, "WATCHED_ADDRESS_IDENTITY_IMMUTABLE");
}

export function rejectCustodyMaterial(body: Record<string, unknown>) {
  rejectKeys(body, CUSTODY_KEYS, "CUSTODY_MATERIAL_FORBIDDEN");
}

export function rejectEvidenceClientStorageAuthority(body: Record<string, unknown>) {
  rejectKeys(body, EVIDENCE_CLIENT_STORAGE_AUTHORITY_KEYS, "EVIDENCE_CLIENT_STORAGE_AUTHORITY");
}

export function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TreasuryValidationError("INVALID_ENUM", `${label} is not a permitted value`);
  }
  return value as T;
}

export function parseTxDirection(value: unknown) {
  return parseEnum(value, treasuryTxDirectionEnum, "direction");
}

export function parseTxKind(value: unknown) {
  return parseEnum(value, treasuryTxKindEnum, "kind");
}

export function parseTxStatus(value: unknown) {
  return parseEnum(value, treasuryTxStatusEnum, "status");
}

export function parseDetailPublication(value: unknown) {
  return parseEnum(value, treasuryDetailPublicationEnum, "detail_publication");
}

export function parseBudgetStatus(value: unknown) {
  return parseEnum(value, treasuryBudgetStatusEnum, "status");
}

export function parseFundingNeedStatus(value: unknown) {
  return parseEnum(value, treasuryFundingNeedStatusEnum, "status");
}

export function parseEvidenceKind(value: unknown) {
  return parseEnum(value, treasuryEvidenceKindEnum, "kind");
}

export function parseEvidenceVisibility(value: unknown) {
  return parseEnum(value, treasuryEvidenceVisibilityEnum, "visibility");
}

export function parseSemanticPatch(raw: unknown): TreasurySemanticPatch {
  const patch = asObject(raw, "patch");
  const out: TreasurySemanticPatch = {};
  if (patch.kind !== undefined) {
    out.kind = patch.kind === null ? null : parseTxKind(patch.kind);
  }
  if (patch.direction !== undefined) out.direction = parseTxDirection(patch.direction);
  if (patch.fund_bucket_code !== undefined || patch.fundBucketCode !== undefined) {
    out.fundBucketCode = requireString(
      patch.fund_bucket_code ?? patch.fundBucketCode,
      "fund_bucket_code",
    );
  }
  if (patch.accounting_amount_micros !== undefined || patch.accountingAmountMicros !== undefined) {
    out.accountingAmountMicros = parsePositiveDecimalBigint(
      patch.accounting_amount_micros ?? patch.accountingAmountMicros,
      "accounting_amount_micros",
    );
  }
  if (patch.purpose !== undefined) out.purpose = optionalString(patch.purpose, "purpose");
  if (patch.category !== undefined) out.category = optionalString(patch.category, "category");
  if (patch.internal_notes !== undefined || patch.internalNotes !== undefined) {
    out.internalNotes = optionalString(
      patch.internal_notes ?? patch.internalNotes,
      "internal_notes",
    );
  }
  if (patch.public_description !== undefined || patch.publicDescription !== undefined) {
    out.publicDescription = optionalString(
      patch.public_description ?? patch.publicDescription,
      "public_description",
    );
  }
  if (patch.budget_id !== undefined || patch.budgetId !== undefined) {
    const budgetId = patch.budget_id ?? patch.budgetId;
    out.budgetId = budgetId === null ? null : requireString(budgetId, "budget_id");
  }
  if (patch.funding_need_id !== undefined || patch.fundingNeedId !== undefined) {
    const fundingNeedId = patch.funding_need_id ?? patch.fundingNeedId;
    out.fundingNeedId =
      fundingNeedId === null ? null : requireString(fundingNeedId, "funding_need_id");
  }
  if (patch.publish_counterparty !== undefined || patch.publishCounterparty !== undefined) {
    out.publishCounterparty = requireBoolean(
      patch.publish_counterparty ?? patch.publishCounterparty,
      "publish_counterparty",
    );
  }
  if (patch.counterparty_display !== undefined || patch.counterpartyDisplay !== undefined) {
    out.counterpartyDisplay = optionalString(
      patch.counterparty_display ?? patch.counterpartyDisplay,
      "counterparty_display",
    );
  }
  if (patch.corrects_transaction_id !== undefined || patch.correctsTransactionId !== undefined) {
    const id = patch.corrects_transaction_id ?? patch.correctsTransactionId;
    out.correctsTransactionId = id === null ? null : requireString(id, "corrects_transaction_id");
  }
  return out;
}

export { parseDecimalBigint, parsePositiveDecimalBigint };
