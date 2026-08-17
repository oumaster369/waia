import {
  TREASURY_USDT_V1_ASSET,
  TREASURY_USDT_V1_DECIMALS,
  treasuryTxDirectionEnum,
  treasuryTxKindEnum,
} from "@/lib/treasury-admin/canonical";
import { parseHumanDecimalToAtomic } from "@/lib/treasury-admin/parse-human-amount";

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
  };
  if (values.accountingAmountMicros.trim() !== "") {
    patch.accountingAmountMicros = values.accountingAmountMicros.trim();
  }
  return patch;
}
