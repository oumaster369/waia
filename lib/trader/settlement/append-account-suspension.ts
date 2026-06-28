import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { AccountStatusRepository } from "@/lib/trader/settlement/account-status-repository.types";
import {
  assertSuspensionAllowed,
  resolveStatusAfterSuspension,
  shouldAppendSuspensionEvent,
} from "@/lib/trader/settlement/account-status.transitions";
import { buildAccountStatusEventPayload } from "@/lib/trader/settlement/serialize-settlement";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type AppendAccountSuspensionInput = {
  exchangeAccountId: string;
  sourceInvoiceId: string;
  reason?: string;
  now?: Date;
};

export type AppendAccountSuspensionDeps = {
  accountStatusRepository: AccountStatusRepository;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
};

/** Append SUSPENDED event when account is not already suspended (idempotent). */
export async function appendAccountSuspensionIfNeeded(
  deps: AppendAccountSuspensionDeps,
  context: OrgContext,
  input: AppendAccountSuspensionInput,
): Promise<boolean> {
  const now = input.now ?? new Date();
  const reason = input.reason ?? "overdue_invoice";
  const current = await deps.accountStatusRepository.getProjection(
    context,
    input.exchangeAccountId,
  );
  if (!shouldAppendSuspensionEvent(current?.status ?? null)) {
    return false;
  }

  assertSuspensionAllowed(current?.status ?? null, "SUSPENDED");

  const events = await deps.accountStatusRepository.listEventsForAccount(
    context,
    input.exchangeAccountId,
  );
  const lastEvent = events.at(-1) ?? null;
  const seq = (lastEvent?.seq ?? 0) + 1;
  const eventPayload = buildAccountStatusEventPayload({
    organizationId: context.organizationId,
    exchangeAccountId: input.exchangeAccountId,
    seq,
    eventType: "SUSPENDED",
    reason,
    sourcePaymentId: null,
    sourceInvoiceId: input.sourceInvoiceId,
    prevEventDigest: lastEvent?.recordContentDigest ?? null,
  });

  const projection = {
    organizationId: context.organizationId,
    exchangeAccountId: input.exchangeAccountId,
    status: resolveStatusAfterSuspension(),
    reason,
    lastEventSeq: seq,
    lastEventDigest: eventPayload.recordContentDigest,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };

  await deps.accountStatusRepository.appendEventAndProjection(context, eventPayload, projection);
  await deps.writeAudit({
    actorType: "service",
    actorId: null,
    action: traderAuditActions.accountSuspended,
    entityType: traderEntityTypes.accountStatus,
    entityId: input.exchangeAccountId,
    organizationId: context.organizationId,
    metadata: {
      sourceInvoiceId: input.sourceInvoiceId,
      previousStatus: current?.status ?? null,
      reason,
    },
  });
  return true;
}
