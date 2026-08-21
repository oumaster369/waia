import {
  TREASURY_USDT_V1_ASSET,
  TREASURY_USDT_V1_DECIMALS,
  treasuryTxDirectionEnum,
  treasuryTxKindEnum,
} from "@/lib/treasury-admin/canonical";
import { parseHumanDecimalToAtomic } from "@/lib/treasury-admin/parse-human-amount";
import { parseHumanSignedAmount } from "@/lib/treasury-admin/ledger";

export type CentralLedgerFormValues = {
  organizationId: string;
  status: "NEEDS_REVIEW" | "PLANNED";
  humanAmount: string;
  occurredAtIso: string;
  currency: string;
  counterpartyId: string;
  accountId: string;
  categoryId: string;
  projectId: string;
  notes: string;
  correctsTransactionId?: string;
  reason: string;
};

export type CentralLedgerPostBody = {
  organization_id: string;
  status: "NEEDS_REVIEW" | "PLANNED";
  signed_amount_micros: string;
  native_amount_atomic: string;
  native_decimals: 6;
  native_asset: string;
  occurred_at: string;
  counterparty_id: string | null;
  account_id: string | null;
  category_id: string | null;
  project_id: string | null;
  notes: string | null;
  kind?: "CORRECTION";
  corrects_transaction_id?: string;
  reason: string;
};

export function buildCentralLedgerPostBody(
  values: CentralLedgerFormValues,
  options?: { requireReason?: boolean; now?: Date },
): { ok: true; body: CentralLedgerPostBody } | { ok: false; message: string } {
  const organizationId = values.organizationId.trim();
  if (!organizationId) return { ok: false, message: "Select an organization first." };
  const amount = parseHumanSignedAmount(values.humanAmount);
  if (!amount.ok) return amount;
  const occurredAt = values.occurredAtIso.trim();
  if (!occurredAt) return { ok: false, message: "Choose the transaction date and time." };
  const occurred = new Date(occurredAt);
  if (Number.isNaN(occurred.getTime())) {
    return { ok: false, message: "Choose a valid transaction date and time." };
  }
  if (values.status === "PLANNED" && occurred <= (options?.now ?? new Date())) {
    return { ok: false, message: "Planned transactions must have a future date and time." };
  }
  const currency = values.currency.trim();
  if (!values.accountId.trim()) return { ok: false, message: "Choose an account." };
  if (!currency) return { ok: false, message: "Choose an account with a currency." };
  const reason = values.reason.trim();
  if (options?.requireReason !== false && !reason) {
    return { ok: false, message: "Add a reason for this audited change." };
  }
  const optionalId = (value: string) => (value.trim() ? value.trim() : null);
  const correctsTransactionId = values.correctsTransactionId?.trim() ?? "";
  const body: CentralLedgerPostBody = {
    organization_id: organizationId,
    status: values.status,
    signed_amount_micros: amount.micros,
    native_amount_atomic: amount.magnitudeMicros,
    native_decimals: 6,
    native_asset: currency,
    occurred_at: occurredAt,
    counterparty_id: optionalId(values.counterpartyId),
    account_id: optionalId(values.accountId),
    category_id: optionalId(values.categoryId),
    project_id: optionalId(values.projectId),
    notes: values.notes.trim() || null,
    reason,
  };
  if (correctsTransactionId) {
    body.kind = "CORRECTION";
    body.corrects_transaction_id = correctsTransactionId;
  }
  return {
    ok: true,
    body,
  };
}

export type ManualDraftFormValues = {
  organizationId: string;
  direction: string;
  kind: string;
  humanAmount: string;
  occurredAtIso: string;
  purpose: string;
  budgetId: string;
  fundingNeedId: string;
  correctsTransactionId: string;
  reason: string;
};

export type ManualDraftPostBody = {
  organization_id: string;
  direction: (typeof treasuryTxDirectionEnum)[number];
  kind?: (typeof treasuryTxKindEnum)[number] | null;
  native_amount_atomic: string;
  native_decimals: typeof TREASURY_USDT_V1_DECIMALS;
  native_asset: typeof TREASURY_USDT_V1_ASSET;
  occurred_at: string;
  purpose: string | null;
  budget_id: string | null;
  funding_need_id: string | null;
  corrects_transaction_id: string | null;
  reason: string;
};

export type BuildManualDraftResult =
  | { ok: true; body: ManualDraftPostBody }
  | { ok: false; message: string };

export function buildManualDraftPostBody(
  values: ManualDraftFormValues,
  options?: { requireReason?: boolean },
): BuildManualDraftResult {
  const organizationId = values.organizationId.trim();
  if (!organizationId) {
    return { ok: false, message: "Select an organization before creating a draft." };
  }

  if (
    !treasuryTxDirectionEnum.includes(values.direction as (typeof treasuryTxDirectionEnum)[number])
  ) {
    return { ok: false, message: "Choose a canonical direction." };
  }

  let kind: (typeof treasuryTxKindEnum)[number] | null = null;
  if (values.kind.trim() !== "") {
    if (!treasuryTxKindEnum.includes(values.kind as (typeof treasuryTxKindEnum)[number])) {
      return {
        ok: false,
        message: "Choose a canonical kind, or leave the transaction unclassified.",
      };
    }
    kind = values.kind as (typeof treasuryTxKindEnum)[number];
  }

  const amount = parseHumanDecimalToAtomic(values.humanAmount, TREASURY_USDT_V1_DECIMALS, {
    requirePositive: true,
  });
  if (!amount.ok) {
    return { ok: false, message: amount.message };
  }

  const occurredAt = values.occurredAtIso.trim();
  if (!occurredAt) {
    return { ok: false, message: "Choose when this transaction occurred." };
  }

  const reason = values.reason.trim();
  if (options?.requireReason !== false && !reason) {
    return { ok: false, message: "A reason is required to create this audited draft." };
  }

  const purpose = values.purpose.trim();
  const budgetId = values.budgetId.trim();
  const fundingNeedId = values.fundingNeedId.trim();
  const correctsTransactionId = values.correctsTransactionId.trim();

  const body: ManualDraftPostBody = {
    organization_id: organizationId,
    direction: values.direction as (typeof treasuryTxDirectionEnum)[number],
    native_amount_atomic: amount.atomic,
    native_decimals: TREASURY_USDT_V1_DECIMALS,
    native_asset: TREASURY_USDT_V1_ASSET,
    occurred_at: occurredAt,
    purpose: purpose === "" ? null : purpose,
    budget_id: budgetId === "" ? null : budgetId,
    funding_need_id: fundingNeedId === "" ? null : fundingNeedId,
    corrects_transaction_id: correctsTransactionId === "" ? null : correctsTransactionId,
    reason,
  };
  if (kind === null) {
    body.kind = null;
  } else {
    body.kind = kind;
  }
  return { ok: true, body };
}

export type ClassifyMeaningValues = {
  kind: string;
  direction: string;
  fundBucketCode: string;
  purpose: string;
  category: string;
  projectModule: string;
  milestoneStage: string;
  budgetId: string;
  fundingNeedId: string;
  accountingAmountMicros: string;
  description: string;
  internalNotes: string;
  publicDescription: string;
  counterpartyDisplay: string;
  publishCounterparty: boolean;
  counterpartyId?: string;
  accountId?: string;
  categoryId?: string;
  projectId?: string;
};

export function buildClassifyCommandPatch(values: ClassifyMeaningValues): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    kind: values.kind.trim() === "" ? null : values.kind,
    direction: values.direction,
    fundBucketCode: values.fundBucketCode,
    purpose: values.purpose.trim() === "" ? null : values.purpose,
    category: values.category.trim() === "" ? null : values.category,
    projectModule: values.projectModule.trim() === "" ? null : values.projectModule,
    milestoneStage: values.milestoneStage.trim() === "" ? null : values.milestoneStage,
    budgetId: values.budgetId.trim() === "" ? null : values.budgetId,
    fundingNeedId: values.fundingNeedId.trim() === "" ? null : values.fundingNeedId,
    description: values.description.trim() === "" ? null : values.description,
    internalNotes: values.internalNotes.trim() === "" ? null : values.internalNotes,
    publicDescription: values.publicDescription.trim() === "" ? null : values.publicDescription,
    counterpartyDisplay:
      values.counterpartyDisplay.trim() === "" ? null : values.counterpartyDisplay,
    publishCounterparty: values.publishCounterparty,
    counterpartyId: values.counterpartyId?.trim() || null,
    accountId: values.accountId?.trim() || null,
    categoryId: values.categoryId?.trim() || null,
    projectId: values.projectId?.trim() || null,
  };
  if (values.accountingAmountMicros.trim() !== "") {
    patch.accountingAmountMicros = values.accountingAmountMicros.trim();
  }
  return patch;
}
