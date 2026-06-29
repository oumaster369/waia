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
import { RECONCILIATION_EVENT_PROPOSAL_CANCELLED } from "@/lib/trader/settlement/reconciliation/reconciliation.events";
import type {
  ReconciliationCaseView,
  ReconciliationCommandBase,
  ReconciliationEventRecordView,
  ReconciliationOperatorContext,
} from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

export type CancelProposalDeps = {
  caseRepository: ReconciliationCaseRepository;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
};

export type CancelProposalInput = ReconciliationCommandBase & {
  reason: string;
};

export async function cancelProposal(
  deps: CancelProposalDeps,
  context: OrgContext,
  operator: ReconciliationOperatorContext,
  input: CancelProposalInput,
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
  if (!caseView.currentDecisionId) {
    throw new ReconciliationMissingRationaleError("currentDecisionId");
  }

  const nextStatus = assertReconciliationTransitionAllowed(
    caseView.id,
    caseView.status,
    reconciliationCommands.cancelProposal,
  );

  const event = buildWorkflowEventPayload(
    caseView,
    scoped.organizationId,
    RECONCILIATION_EVENT_PROPOSAL_CANCELLED,
    operator.actorType,
    operator.actorId,
    {
      decisionId: caseView.currentDecisionId,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    },
  );

  const result = await deps.caseRepository.appendEvent(scoped, {
    caseId: input.caseId,
    expectedLastEventSeq: input.expectedLastEventSeq,
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
    action: traderAuditActions.settlementReconciliationProposalCancelled,
    entityType: traderEntityTypes.settlementReconciliationCase,
    entityId: input.caseId,
    organizationId: scoped.organizationId,
    metadata: {
      decisionId: caseView.currentDecisionId,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    },
  });

  return result;
}
