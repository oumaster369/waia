import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import {
  RECONCILIATION_EVENT_CASE_OPENED,
  buildCaseOpenedEventPayload,
} from "@/lib/trader/settlement/reconciliation/reconciliation.events";
import { ReconciliationInvalidSettlementOutcomeError } from "@/lib/trader/settlement/reconciliation/reconciliation.errors";
import type { ReconciliationCaseRepository } from "@/lib/trader/settlement/reconciliation/reconciliation-case-repository.types";
import type { ReconciliationEvidenceReader } from "@/lib/trader/settlement/reconciliation/reconciliation-evidence.types";
import { computeReconciliationPriority } from "@/lib/trader/settlement/reconciliation/reconciliation-priority";
import type { ReconciliationCaseView } from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import { buildReconciliationEventPayload } from "@/lib/trader/settlement/reconciliation/serialize-reconciliation";
import type { SettlementRecordView } from "@/lib/trader/settlement/settlement.types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import { isUniqueConstraintError } from "@/lib/trader/execution/order-repository.types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

export type CreateCaseDeps = {
  caseRepository: ReconciliationCaseRepository;
  evidenceReader: ReconciliationEvidenceReader;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
  now?: () => Date;
};

export type CreateCaseInput = {
  settlement: SettlementRecordView;
};

function isCaseUniqueViolation(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: string }).code;
    if (code === "23505" || code === "SQLITE_CONSTRAINT_UNIQUE") {
      return true;
    }
  }
  if (isUniqueConstraintError(error)) {
    return true;
  }
  if (error && typeof error === "object" && "message" in error) {
    return /UNIQUE constraint failed/i.test(String((error as { message: unknown }).message));
  }
  return false;
}

/** Canonical domain entrypoint — sole creator of reconciliation cases and CASE_OPENED events. */
export async function createCase(
  deps: CreateCaseDeps,
  context: OrgContext,
  input: CreateCaseInput,
): Promise<ReconciliationCaseView> {
  const scoped = requireOrgContext(context.organizationId);
  const { settlement } = input;

  if (settlement.outcome !== "EXCEPTION") {
    throw new ReconciliationInvalidSettlementOutcomeError(settlement.outcome);
  }

  const existing = await deps.caseRepository.findBySettlementId(scoped, settlement.id);
  if (existing) {
    return existing;
  }

  const now = deps.now?.() ?? new Date();
  const evidence = await deps.evidenceReader.buildEvidence(scoped, settlement);
  const priority = computeReconciliationPriority({
    exceptionReason: settlement.exceptionReason,
    openedAt: now,
    now,
  });
  const caseId = crypto.randomUUID();
  const eventPayload = buildReconciliationEventPayload({
    organizationId: scoped.organizationId,
    caseId,
    seq: 1,
    eventType: RECONCILIATION_EVENT_CASE_OPENED,
    actorType: "service",
    actorId: null,
    payload: buildCaseOpenedEventPayload({
      evidenceSnapshot: evidence,
      exceptionReason: settlement.exceptionReason,
      priority,
    }),
    prevEventDigest: null,
  });

  try {
    const opened = await deps.caseRepository.openCase(scoped, {
      caseId,
      settlementId: settlement.id,
      paymentId: settlement.paymentId,
      exchangeAccountId: settlement.exchangeAccountId,
      exceptionReason: settlement.exceptionReason,
      priority,
      openedAt: now,
      event: eventPayload,
    });

    await deps.writeAudit({
      actorType: "service",
      actorId: null,
      action: traderAuditActions.settlementReconciliationCaseOpened,
      entityType: traderEntityTypes.settlementReconciliationCase,
      entityId: opened.case.id,
      organizationId: scoped.organizationId,
      metadata: {
        settlementId: settlement.id,
        paymentId: settlement.paymentId,
        exceptionReason: settlement.exceptionReason,
      },
    });

    return opened.case;
  } catch (error) {
    if (isCaseUniqueViolation(error)) {
      const raced = await deps.caseRepository.findBySettlementId(scoped, settlement.id);
      if (raced) {
        return raced;
      }
    }
    throw error;
  }
}

/** Thin adapter for settlement-service hook — delegates to createCase(). */
export async function createCaseOnExceptionFromSettlement(
  deps: CreateCaseDeps,
  context: OrgContext,
  settlement: SettlementRecordView,
): Promise<void> {
  await createCase(deps, context, { settlement });
}
