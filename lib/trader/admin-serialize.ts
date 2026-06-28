import type { CredentialMetadataDto } from "@/lib/trader/credentials/connect-api.types";
import { toCredentialMetadataDto } from "@/lib/trader/credentials/connect-api.types";
import type { CredentialMetadata } from "@/lib/trader/credentials/types";
import type { InvoiceRecordView, IssuedInvoiceView } from "@/lib/trader/billing/invoice.types";
import type {
  InvoiceCorrectionRecordView,
  InvoiceDisputeProjectionView,
} from "@/lib/trader/billing/governance/billing-governance.types";
import type {
  OrgLiveEnableEventView,
  OrgLiveEnablePreview,
  OrgLiveEnableView,
} from "@/lib/trader/live/types";
import type {
  EffectiveKillSwitchState,
  KillSwitchTransitionResult,
  KillSwitchView,
  RecoveryPreview,
} from "@/lib/trader/risk/kill-switch/types";
import type {
  AccountStatusEventRecordView,
  AccountStatusProjectionView,
} from "@/lib/trader/settlement/settlement.types";
import type {
  PromotionPreview,
  StrategyPromotionRecordView,
} from "@/lib/trader/validation-gate/strategy-promotion-record.types";

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function serializeKillSwitchView(row: KillSwitchView): Record<string, unknown> {
  return {
    ...row,
    clearingStartedAt: iso(row.clearingStartedAt),
    trippedAt: iso(row.trippedAt),
    clearedAt: iso(row.clearedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function serializeKillSwitchTransitionResult(
  result: KillSwitchTransitionResult,
): Record<string, unknown> {
  return {
    row: serializeKillSwitchView(result.row),
    auditId: result.auditId,
    previousState: result.previousState,
  };
}

export function serializeRecoveryPreview(preview: RecoveryPreview): Record<string, unknown> {
  return {
    ...preview,
    clearingStartedAt: iso(preview.clearingStartedAt),
    eligibleAt: iso(preview.eligibleAt),
  };
}

export function serializeEffectiveKillSwitchState(
  state: EffectiveKillSwitchState,
): Record<string, unknown> {
  return state;
}

export function serializeOrgLiveEnableView(state: OrgLiveEnableView): Record<string, unknown> {
  return {
    ...state,
    requestedAt: iso(state.requestedAt),
    coolingOffEndsAt: iso(state.coolingOffEndsAt),
    enabledAt: iso(state.enabledAt),
    disabledAt: iso(state.disabledAt),
    createdAt: iso(state.createdAt),
    updatedAt: iso(state.updatedAt),
  };
}

export function serializeOrgLiveEnableEvent(
  event: OrgLiveEnableEventView,
): Record<string, unknown> {
  return {
    ...event,
    createdAt: iso(event.createdAt),
  };
}

export function serializeOrgLiveEnablePreview(
  preview: OrgLiveEnablePreview,
): Record<string, unknown> {
  return {
    ...preview,
    state: preview.state ? serializeOrgLiveEnableView(preview.state) : null,
    eligibleAt: iso(preview.eligibleAt),
  };
}

export function serializePromotionRecord(
  record: StrategyPromotionRecordView,
): Record<string, unknown> {
  return {
    ...record,
    requestedAt: iso(record.requestedAt),
    confirmedAt: iso(record.confirmedAt),
    coolingOffEndsAt: iso(record.coolingOffEndsAt),
    effectiveAt: iso(record.effectiveAt),
    cancelledAt: iso(record.cancelledAt),
    revokedAt: iso(record.revokedAt),
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  };
}

export function serializePromotionPreview(preview: PromotionPreview): Record<string, unknown> {
  return {
    ...preview,
    record: serializePromotionRecord(preview.record),
    eligibleAt: iso(preview.eligibleAt),
  };
}

export function serializeInvoiceRecord(invoice: InvoiceRecordView): Record<string, unknown> {
  return {
    ...invoice,
    periodStart: iso(invoice.periodStart),
    periodEnd: iso(invoice.periodEnd),
    feeComputedAt: iso(invoice.feeComputedAt),
    issuanceApprovedAt: iso(invoice.issuanceApprovedAt),
    coolingOffUntil: iso(invoice.coolingOffUntil),
    issuedAt: iso(invoice.issuedAt),
    paidAt: iso(invoice.paidAt),
    createdAt: iso(invoice.createdAt),
    updatedAt: iso(invoice.updatedAt),
  };
}

export function serializeIssuedInvoice(invoice: IssuedInvoiceView): Record<string, unknown> {
  return serializeInvoiceRecord(invoice);
}

export function serializeDisputeProjection(
  dispute: InvoiceDisputeProjectionView,
): Record<string, unknown> {
  return {
    ...dispute,
    openedAt: iso(dispute.openedAt),
    resolvedAt: iso(dispute.resolvedAt),
    createdAt: iso(dispute.createdAt),
    updatedAt: iso(dispute.updatedAt),
  };
}

export function serializeCorrectionRecord(
  correction: InvoiceCorrectionRecordView,
): Record<string, unknown> {
  return {
    ...correction,
    createdAt: iso(correction.createdAt),
  };
}

export function serializeAccountStatusProjection(
  projection: AccountStatusProjectionView,
): Record<string, unknown> {
  return {
    ...projection,
    createdAt: iso(projection.createdAt),
    updatedAt: iso(projection.updatedAt),
  };
}

export function serializeAccountStatusEvent(
  event: AccountStatusEventRecordView,
): Record<string, unknown> {
  return {
    ...event,
    createdAt: iso(event.createdAt),
  };
}

export function serializeCredentialMetadata(metadata: CredentialMetadata): CredentialMetadataDto {
  return toCredentialMetadataDto(metadata);
}
