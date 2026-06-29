import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import {
  assertReconciliationTransitionAllowed,
  reconciliationCommands,
} from "@/lib/trader/settlement/reconciliation/reconciliation.transitions";
import {
  assertLeaseHolder,
  buildWorkflowEventPayload,
  findIdempotentEvent,
  loadCommandContext,
} from "@/lib/trader/settlement/reconciliation/reconciliation-command.helpers";
import type { ReconciliationCaseRepository } from "@/lib/trader/settlement/reconciliation/reconciliation-case-repository.types";
import { ReconciliationMissingRationaleError } from "@/lib/trader/settlement/reconciliation/reconciliation.errors";
import {
  RECONCILIATION_EVENT_CASE_ESCALATED,
  RECONCILIATION_EVENT_PROPOSAL_CANCELLED,
} from "@/lib/trader/settlement/reconciliation/reconciliation.events";
import type {
  ReconciliationCaseView,
  ReconciliationCommandBase,
  ReconciliationEventRecordView,
  ReconciliationOperatorContext,
} from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

export type EscalateExternalDeps = {
  caseRepository: ReconciliationCaseRepository;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
};

export type EscalateExternalInput = ReconciliationCommandBase & {
  reason: string;
};

export async function escalateExternal(
  deps: EscalateExternalDeps,
  context: OrgContext,
  operator: ReconciliationOperatorContext,
  input: EscalateExternalInput,
): Promise<{ case: ReconciliationCaseView; event: ReconciliationEventRecordView }> {
  const scoped = requireOrgContext(context.organizationId);
  if (!input.reason.trim()) {
    throw new ReconciliationMissingRationaleError("reason");
  }

  const { caseView, events } = await loadCommandContext(deps.caseRepository, scoped, input);
  const duplicate = findIdempotentEvent(events, input.idempotencyKey);
  if (duplicate) {
    return { case: caseView, event: duplicate };
  }
  assertLeaseHolder(caseView, operator);

  let workingCase = caseView;
  let expectedSeq = input.expectedLastEventSeq;

  if (caseView.status === "DECISION_PENDING" && caseView.currentDecisionId) {
    const cancelEvent = buildWorkflowEventPayload(
      caseView,
      scoped.organizationId,
      RECONCILIATION_EVENT_PROPOSAL_CANCELLED,
      operator.actorType,
      operator.actorId,
      {
        decisionId: caseView.currentDecisionId,
        reason: `Cancelled for escalation: ${input.reason}`,
        idempotencyKey: `${input.idempotencyKey}:cancel`,
      },
    );
    const cancelled = await deps.caseRepository.appendEvent(scoped, {
      caseId: input.caseId,
      expectedLastEventSeq: expectedSeq,
      event: cancelEvent,
      projection: {
        status: "UNDER_REVIEW",
        resolutionType: null,
        currentDecisionId: null,
        coolingOffUntil: null,
        lastEventSeq: cancelEvent.seq,
        lastEventDigest: cancelEvent.recordContentDigest,
      },
    });
    workingCase = cancelled.case;
    expectedSeq = cancelled.case.lastEventSeq;
  }

  const nextStatus = assertReconciliationTransitionAllowed(
    workingCase.id,
    workingCase.status,
    reconciliationCommands.escalateExternal,
  );

  const event = buildWorkflowEventPayload(
    workingCase,
    scoped.organizationId,
    RECONCILIATION_EVENT_CASE_ESCALATED,
    operator.actorType,
    operator.actorId,
    {
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    },
  );

  const result = await deps.caseRepository.appendEvent(scoped, {
    caseId: input.caseId,
    expectedLastEventSeq: expectedSeq,
    event,
    projection: {
      status: nextStatus,
      resolutionType: null,
      currentDecisionId: null,
      coolingOffUntil: null,
      lastEventSeq: event.seq,
      lastEventDigest: event.recordContentDigest,
    },
  });

  await deps.writeAudit({
    actorType: operator.actorType,
    actorId: operator.actorId,
    action: traderAuditActions.settlementReconciliationEscalated,
    entityType: traderEntityTypes.settlementReconciliationCase,
    entityId: input.caseId,
    organizationId: scoped.organizationId,
    metadata: { reason: input.reason, idempotencyKey: input.idempotencyKey },
  });

  return result;
}
