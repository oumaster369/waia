import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { AccountStatusRepository } from "@/lib/trader/settlement/account-status-repository.types";
import type { InvoiceSettlementRepository } from "@/lib/trader/settlement/account-status-repository.types";
import {
  resolveStatusAfterReactivation,
  shouldAppendReactivationEvent,
} from "@/lib/trader/settlement/account-status.transitions";
import { buildAccountStatusEventPayload } from "@/lib/trader/settlement/serialize-settlement";
import type { SettlementApplicationsRepository } from "@/lib/trader/settlement/settlements-repository.types";
import type { SettlementApplicationRecordPayload } from "@/lib/trader/settlement/settlement.types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type ApplySettlementApplicationInput = {
  applicationPayload: SettlementApplicationRecordPayload;
  applicationSource: "AUTO" | "MANUAL";
  reconciliationCaseId?: string | null;
  decisionId?: string | null;
  paymentId: string;
  exchangeAccountId: string;
  now?: Date;
};

export type ApplySettlementApplicationDeps = {
  settlementApplicationsRepository: SettlementApplicationsRepository;
  invoiceSettlementRepository: InvoiceSettlementRepository;
  accountStatusRepository: AccountStatusRepository;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
};

export type ApplySettlementApplicationResult = {
  applicationId: string;
  invoiceId: string;
  appliedAmount: string;
  accountReactivated: boolean;
};

async function appendReactivationIfNeeded(
  deps: ApplySettlementApplicationDeps,
  context: OrgContext,
  exchangeAccountId: string,
  paymentId: string,
  invoiceId: string,
  now: Date,
): Promise<boolean> {
  const current = await deps.accountStatusRepository.getProjection(context, exchangeAccountId);
  if (!shouldAppendReactivationEvent(current?.status ?? null)) {
    return false;
  }

  const events = await deps.accountStatusRepository.listEventsForAccount(
    context,
    exchangeAccountId,
  );
  const lastEvent = events.at(-1) ?? null;
  const seq = (lastEvent?.seq ?? 0) + 1;
  const eventPayload = buildAccountStatusEventPayload({
    organizationId: context.organizationId,
    exchangeAccountId,
    seq,
    eventType: "REACTIVATED",
    reason: "confirmed_settlement",
    sourcePaymentId: paymentId,
    sourceInvoiceId: invoiceId,
    prevEventDigest: lastEvent?.recordContentDigest ?? null,
  });

  const projection = {
    organizationId: context.organizationId,
    exchangeAccountId,
    status: resolveStatusAfterReactivation(),
    reason: "confirmed_settlement",
    lastEventSeq: seq,
    lastEventDigest: eventPayload.recordContentDigest,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };

  await deps.accountStatusRepository.appendEventAndProjection(context, eventPayload, projection);
  await deps.writeAudit({
    actorType: "service",
    actorId: null,
    action: traderAuditActions.accountReactivated,
    entityType: traderEntityTypes.accountStatus,
    entityId: exchangeAccountId,
    organizationId: context.organizationId,
    metadata: {
      paymentId,
      invoiceId,
      previousStatus: current?.status ?? null,
    },
  });
  return true;
}

/** Settlement-owned shared effect: application + invoice PAID + optional account reactivation. */
export async function applySettlementApplication(
  deps: ApplySettlementApplicationDeps,
  context: OrgContext,
  input: ApplySettlementApplicationInput,
): Promise<ApplySettlementApplicationResult> {
  const now = input.now ?? new Date();
  const application = await deps.settlementApplicationsRepository.insertApplication(context, {
    payload: input.applicationPayload,
    applicationSource: input.applicationSource,
    reconciliationCaseId: input.reconciliationCaseId ?? null,
    decisionId: input.decisionId ?? null,
  });

  await deps.invoiceSettlementRepository.markInvoicePaid(context, {
    invoiceId: input.applicationPayload.invoiceId,
    settledAmount: input.applicationPayload.appliedAmount,
    paidAt: now,
  });

  const accountReactivated = await appendReactivationIfNeeded(
    deps,
    context,
    input.exchangeAccountId,
    input.paymentId,
    input.applicationPayload.invoiceId,
    now,
  );

  return {
    applicationId: application.id,
    invoiceId: input.applicationPayload.invoiceId,
    appliedAmount: input.applicationPayload.appliedAmount,
    accountReactivated,
  };
}
