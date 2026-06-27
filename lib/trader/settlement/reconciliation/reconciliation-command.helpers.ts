import {
  ReconciliationCaseNotFoundError,
  ReconciliationStaleConcurrencyTokenError,
  ReconciliationTerminalCaseError,
  ReconciliationNotLeaseHolderError,
} from "@/lib/trader/settlement/reconciliation/reconciliation.errors";
import { findEventByIdempotencyKey } from "@/lib/trader/settlement/reconciliation/fold-reconciliation-events";
import type { ReconciliationCaseRepository } from "@/lib/trader/settlement/reconciliation/reconciliation-case-repository.types";
import { buildReconciliationEventPayload } from "@/lib/trader/settlement/reconciliation/serialize-reconciliation";
import type { ReconciliationEventPayload } from "@/lib/trader/settlement/reconciliation/reconciliation.event-payloads";
import type {
  ReconciliationCaseView,
  ReconciliationCommandBase,
  ReconciliationEventRecordPayload,
  ReconciliationEventRecordView,
  ReconciliationOperatorContext,
} from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import { isTerminalReconciliationStatus } from "@/lib/trader/settlement/reconciliation/reconciliation.transitions";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export async function loadCaseOrThrow(
  repository: ReconciliationCaseRepository,
  context: OrgContext,
  caseId: string,
): Promise<ReconciliationCaseView> {
  const caseView = await repository.findById(context, caseId);
  if (!caseView) {
    throw new ReconciliationCaseNotFoundError(caseId);
  }
  return caseView;
}

export function assertNotTerminal(caseView: ReconciliationCaseView): void {
  if (isTerminalReconciliationStatus(caseView.status)) {
    throw new ReconciliationTerminalCaseError(caseView.id);
  }
}

export function assertConcurrencyToken(
  caseView: ReconciliationCaseView,
  expectedLastEventSeq: number,
): void {
  if (caseView.lastEventSeq !== expectedLastEventSeq) {
    throw new ReconciliationStaleConcurrencyTokenError(
      caseView.id,
      expectedLastEventSeq,
      caseView.lastEventSeq,
    );
  }
}

export function assertLeaseHolder(
  caseView: ReconciliationCaseView,
  operator: ReconciliationOperatorContext,
): void {
  if (caseView.assignedTo !== operator.actorId) {
    throw new ReconciliationNotLeaseHolderError(caseView.id, operator.actorId);
  }
}

export function findIdempotentEvent(
  events: ReconciliationEventRecordView[],
  idempotencyKey: string,
): ReconciliationEventRecordView | null {
  return findEventByIdempotencyKey(events, idempotencyKey);
}

export type LoadedCommandContext = {
  caseView: ReconciliationCaseView;
  events: ReconciliationEventRecordView[];
};

export async function loadCommandContext(
  repository: ReconciliationCaseRepository,
  context: OrgContext,
  input: ReconciliationCommandBase,
): Promise<LoadedCommandContext> {
  const caseView = await loadCaseOrThrow(repository, context, input.caseId);
  const events = await repository.listEventsForCase(context, input.caseId);
  const duplicate = findIdempotentEvent(events, input.idempotencyKey);
  if (duplicate) {
    return { caseView, events };
  }
  assertNotTerminal(caseView);
  assertConcurrencyToken(caseView, input.expectedLastEventSeq);
  return { caseView, events };
}

export function nextEventSeq(caseView: ReconciliationCaseView): number {
  return caseView.lastEventSeq + 1;
}

export function buildWorkflowEventPayload(
  caseView: ReconciliationCaseView,
  organizationId: string,
  eventType: string,
  actorType: ReconciliationOperatorContext["actorType"] | "system",
  actorId: string | null,
  payload: ReconciliationEventPayload,
): ReconciliationEventRecordPayload {
  return buildReconciliationEventPayload({
    organizationId,
    caseId: caseView.id,
    seq: nextEventSeq(caseView),
    eventType,
    actorType,
    actorId,
    payload,
    prevEventDigest: caseView.lastEventDigest,
  });
}
