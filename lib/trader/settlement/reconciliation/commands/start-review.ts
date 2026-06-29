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
import { RECONCILIATION_EVENT_REVIEW_STARTED } from "@/lib/trader/settlement/reconciliation/reconciliation.events";
import type {
  ReconciliationCaseView,
  ReconciliationCommandBase,
  ReconciliationEventRecordView,
  ReconciliationOperatorContext,
} from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

export type StartReviewDeps = {
  caseRepository: ReconciliationCaseRepository;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
};

export async function startReview(
  deps: StartReviewDeps,
  context: OrgContext,
  operator: ReconciliationOperatorContext,
  input: ReconciliationCommandBase,
): Promise<{ case: ReconciliationCaseView; event: ReconciliationEventRecordView }> {
  const scoped = requireOrgContext(context.organizationId);
  const { caseView, events } = await loadCommandContext(deps.caseRepository, scoped, input);
  const duplicate = findIdempotentEvent(events, input.idempotencyKey);
  if (duplicate) {
    return { case: caseView, event: duplicate };
  }
  assertLeaseHolder(caseView, operator);

  const nextStatus = assertReconciliationTransitionAllowed(
    caseView.id,
    caseView.status,
    reconciliationCommands.startReview,
  );
  const event = buildWorkflowEventPayload(
    caseView,
    scoped.organizationId,
    RECONCILIATION_EVENT_REVIEW_STARTED,
    operator.actorType,
    operator.actorId,
    { idempotencyKey: input.idempotencyKey },
  );

  const result = await deps.caseRepository.appendEvent(scoped, {
    caseId: input.caseId,
    expectedLastEventSeq: input.expectedLastEventSeq,
    event,
    projection: {
      status: nextStatus,
      lastEventSeq: event.seq,
      lastEventDigest: event.recordContentDigest,
    },
  });

  await deps.writeAudit({
    actorType: operator.actorType,
    actorId: operator.actorId,
    action: traderAuditActions.settlementReconciliationReviewStarted,
    entityType: traderEntityTypes.settlementReconciliationCase,
    entityId: input.caseId,
    organizationId: scoped.organizationId,
    metadata: { idempotencyKey: input.idempotencyKey },
  });

  return result;
}
