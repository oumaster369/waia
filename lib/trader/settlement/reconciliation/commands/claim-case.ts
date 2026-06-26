import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import {
  assertReconciliationTransitionAllowed,
  reconciliationCommands,
} from "@/lib/trader/settlement/reconciliation/reconciliation.transitions";
import {
  buildWorkflowEventPayload,
  findIdempotentEvent,
  loadCommandContext,
} from "@/lib/trader/settlement/reconciliation/reconciliation-command.helpers";
import type { ReconciliationCaseRepository } from "@/lib/trader/settlement/reconciliation/reconciliation-case-repository.types";
import { computeClaimExpiresAt } from "@/lib/trader/settlement/reconciliation/reconciliation.config";
import { RECONCILIATION_EVENT_CASE_CLAIMED } from "@/lib/trader/settlement/reconciliation/reconciliation.events";
import type {
  ReconciliationCaseView,
  ReconciliationCommandBase,
  ReconciliationEventRecordView,
  ReconciliationOperatorContext,
} from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

export type ClaimCaseDeps = {
  caseRepository: ReconciliationCaseRepository;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
  now?: () => Date;
};

export type ClaimCaseInput = ReconciliationCommandBase & {
  claimLeaseMs?: number | null;
};

export type ClaimCaseResult = {
  case: ReconciliationCaseView;
  event: ReconciliationEventRecordView;
};

export async function claimCase(
  deps: ClaimCaseDeps,
  context: OrgContext,
  operator: ReconciliationOperatorContext,
  input: ClaimCaseInput,
): Promise<ClaimCaseResult> {
  const scoped = requireOrgContext(context.organizationId);
  const { caseView, events } = await loadCommandContext(deps.caseRepository, scoped, input);
  const duplicate = findIdempotentEvent(events, input.idempotencyKey);
  if (duplicate) {
    return { case: caseView, event: duplicate };
  }

  const nextStatus = assertReconciliationTransitionAllowed(
    caseView.id,
    caseView.status,
    reconciliationCommands.claim,
  );
  const now = deps.now?.() ?? new Date();
  const claimExpiresAt = computeClaimExpiresAt(now, input.claimLeaseMs);
  const event = buildWorkflowEventPayload(
    caseView,
    scoped.organizationId,
    RECONCILIATION_EVENT_CASE_CLAIMED,
    operator.actorType,
    operator.actorId,
    {
      assignedTo: operator.actorId,
      claimExpiresAt: claimExpiresAt.toISOString(),
      idempotencyKey: input.idempotencyKey,
    },
  );

  const result = await deps.caseRepository.appendEvent(scoped, {
    caseId: input.caseId,
    expectedLastEventSeq: input.expectedLastEventSeq,
    event,
    projection: {
      status: nextStatus,
      assignedTo: operator.actorId,
      claimExpiresAt,
      lastEventSeq: event.seq,
      lastEventDigest: event.recordContentDigest,
    },
  });

  await deps.writeAudit({
    actorType: operator.actorType,
    actorId: operator.actorId,
    action: traderAuditActions.settlementReconciliationCaseClaimed,
    entityType: traderEntityTypes.settlementReconciliationCase,
    entityId: input.caseId,
    organizationId: scoped.organizationId,
    metadata: {
      claimExpiresAt: claimExpiresAt.toISOString(),
      idempotencyKey: input.idempotencyKey,
    },
  });

  return result;
}
