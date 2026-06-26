import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { InvoiceSettlementRepository } from "@/lib/trader/settlement/account-status-repository.types";
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
import { computeReconciliationCoolingOffUntil } from "@/lib/trader/settlement/reconciliation/reconciliation.config";
import { extractCaseOpenedEvidence } from "@/lib/trader/settlement/reconciliation/fold-reconciliation-events";
import { ReconciliationMissingRationaleError } from "@/lib/trader/settlement/reconciliation/reconciliation.errors";
import { RECONCILIATION_EVENT_RESOLUTION_PROPOSED } from "@/lib/trader/settlement/reconciliation/reconciliation.events";
import {
  buildProjectedImpact,
  validateManualApplyTarget,
} from "@/lib/trader/settlement/reconciliation/reconciliation-validation";
import type {
  ReconciliationCaseView,
  ReconciliationCommandBase,
  ReconciliationEventRecordView,
  ReconciliationOperatorContext,
  ReconciliationResolutionType,
} from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

export type ProposeResolutionDeps = {
  caseRepository: ReconciliationCaseRepository;
  invoiceSettlementRepository: InvoiceSettlementRepository;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
  now?: () => Date;
};

export type ProposeResolutionInput = ReconciliationCommandBase & {
  resolutionType: ReconciliationResolutionType;
  targetInvoiceId?: string | null;
  rationale: string;
  coolingOffMs?: number | null;
  recommendationRef?: string | null;
};

export async function proposeResolution(
  deps: ProposeResolutionDeps,
  context: OrgContext,
  operator: ReconciliationOperatorContext,
  input: ProposeResolutionInput,
): Promise<{ case: ReconciliationCaseView; event: ReconciliationEventRecordView }> {
  const scoped = requireOrgContext(context.organizationId);
  if (!input.rationale.trim()) {
    throw new ReconciliationMissingRationaleError("rationale");
  }

  const { caseView, events } = await loadCommandContext(deps.caseRepository, scoped, input);
  const duplicate = findIdempotentEvent(events, input.idempotencyKey);
  if (duplicate) {
    return { case: caseView, event: duplicate };
  }
  assertLeaseHolder(caseView, operator);

  const nextStatus = assertReconciliationTransitionAllowed(
    caseView.id,
    caseView.status,
    reconciliationCommands.proposeResolution,
  );

  const evidence = extractCaseOpenedEvidence(events);
  const settlementValuedAmount = evidence?.settlement.valuedAmount ?? null;
  let targetInvoiceId = input.targetInvoiceId ?? null;
  let appliedAmount: string | null = null;

  if (input.resolutionType === "MANUAL_APPLY") {
    if (!targetInvoiceId) {
      throw new ReconciliationMissingRationaleError("targetInvoiceId");
    }
    const validated = await validateManualApplyTarget(deps.invoiceSettlementRepository, scoped, {
      targetInvoiceId,
      settlementValuedAmount,
      exchangeAccountId: caseView.exchangeAccountId,
    });
    appliedAmount = validated.performanceFee;
  } else {
    targetInvoiceId = null;
  }

  const now = deps.now?.() ?? new Date();
  const coolingOffUntil = computeReconciliationCoolingOffUntil(now, input.coolingOffMs);
  const decisionId = crypto.randomUUID();
  const projectedImpact = buildProjectedImpact({
    resolutionType: input.resolutionType,
    targetInvoiceId,
    appliedAmount,
    accountReactivation: input.resolutionType === "MANUAL_APPLY",
  });

  const event = buildWorkflowEventPayload(
    caseView,
    scoped.organizationId,
    RECONCILIATION_EVENT_RESOLUTION_PROPOSED,
    operator.actorType,
    operator.actorId,
    {
      decisionId,
      resolutionType: input.resolutionType,
      targetInvoiceId,
      projectedImpact,
      rationale: input.rationale,
      coolingOffUntil: coolingOffUntil.toISOString(),
      recommendationRef: input.recommendationRef ?? null,
      idempotencyKey: input.idempotencyKey,
    },
  );

  const result = await deps.caseRepository.appendEvent(scoped, {
    caseId: input.caseId,
    expectedLastEventSeq: input.expectedLastEventSeq,
    event,
    projection: {
      status: nextStatus,
      resolutionType: input.resolutionType,
      currentDecisionId: decisionId,
      coolingOffUntil,
      lastEventSeq: event.seq,
      lastEventDigest: event.recordContentDigest,
    },
  });

  await deps.writeAudit({
    actorType: operator.actorType,
    actorId: operator.actorId,
    action: traderAuditActions.settlementReconciliationResolutionProposed,
    entityType: traderEntityTypes.settlementReconciliationCase,
    entityId: input.caseId,
    organizationId: scoped.organizationId,
    metadata: {
      decisionId,
      resolutionType: input.resolutionType,
      targetInvoiceId,
      projectedImpact,
      coolingOffUntil: coolingOffUntil.toISOString(),
      rationale: input.rationale,
      idempotencyKey: input.idempotencyKey,
    },
  });

  return result;
}
