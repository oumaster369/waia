import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { InvoiceSettlementRepository } from "@/lib/trader/settlement/account-status-repository.types";
import type { AccountStatusRepository } from "@/lib/trader/settlement/account-status-repository.types";
import {
  applySettlementApplication,
  type ApplySettlementApplicationDeps,
} from "@/lib/trader/settlement/apply-settlement-application";
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
import {
  ReconciliationCoolingOffNotElapsedError,
  ReconciliationProposalNotLiveError,
} from "@/lib/trader/settlement/reconciliation/reconciliation.errors";
import {
  extractCaseOpenedEvidence,
  findLiveProposalEvent,
} from "@/lib/trader/settlement/reconciliation/fold-reconciliation-events";
import { isResolutionProposedPayload } from "@/lib/trader/settlement/reconciliation/reconciliation.event-payloads";
import { RECONCILIATION_EVENT_RESOLUTION_EXECUTED } from "@/lib/trader/settlement/reconciliation/reconciliation.events";
import { validateManualApplyTarget } from "@/lib/trader/settlement/reconciliation/reconciliation-validation";
import type {
  ReconciliationCaseView,
  ReconciliationCommandBase,
  ReconciliationEventRecordView,
  ReconciliationOperatorContext,
} from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import { buildSettlementApplicationPayload } from "@/lib/trader/settlement/serialize-settlement";
import type { SettlementApplicationsRepository } from "@/lib/trader/settlement/settlements-repository.types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

export type ExecuteResolutionDeps = {
  caseRepository: ReconciliationCaseRepository;
  settlementApplicationsRepository: SettlementApplicationsRepository;
  invoiceSettlementRepository: InvoiceSettlementRepository;
  accountStatusRepository: AccountStatusRepository;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
  runAtomic?: <T>(fn: () => Promise<T>) => Promise<T>;
  now?: () => Date;
};

export type ExecuteResolutionInput = ReconciliationCommandBase & {
  decisionId: string;
  confirmToken: string;
};

export async function executeResolution(
  deps: ExecuteResolutionDeps,
  context: OrgContext,
  operator: ReconciliationOperatorContext,
  input: ExecuteResolutionInput,
): Promise<{ case: ReconciliationCaseView; event: ReconciliationEventRecordView }> {
  const scoped = requireOrgContext(context.organizationId);
  if (!input.confirmToken.trim()) {
    throw new ReconciliationProposalNotLiveError(input.caseId, input.decisionId);
  }

  const runAtomic = deps.runAtomic ?? ((fn) => fn());

  return runAtomic(async () => {
    const { caseView, events } = await loadCommandContext(deps.caseRepository, scoped, input);
    const duplicate = findIdempotentEvent(events, input.idempotencyKey);
    if (duplicate) {
      return { case: caseView, event: duplicate };
    }
    assertLeaseHolder(caseView, operator);

    const liveProposal = findLiveProposalEvent(events);
    if (
      !liveProposal ||
      !isResolutionProposedPayload(liveProposal.payload) ||
      liveProposal.payload.decisionId !== input.decisionId ||
      caseView.currentDecisionId !== input.decisionId
    ) {
      throw new ReconciliationProposalNotLiveError(input.caseId, input.decisionId);
    }

    const proposalPayload = liveProposal.payload;
    const now = deps.now?.() ?? new Date();
    if (!caseView.coolingOffUntil || now.getTime() < caseView.coolingOffUntil.getTime()) {
      throw new ReconciliationCoolingOffNotElapsedError(
        input.caseId,
        caseView.coolingOffUntil ?? now,
      );
    }

    const nextStatus = assertReconciliationTransitionAllowed(
      caseView.id,
      caseView.status,
      reconciliationCommands.executeResolution,
    );

    let settlementApplicationRef = null;
    const applyDeps: ApplySettlementApplicationDeps = {
      settlementApplicationsRepository: deps.settlementApplicationsRepository,
      invoiceSettlementRepository: deps.invoiceSettlementRepository,
      accountStatusRepository: deps.accountStatusRepository,
      writeAudit: deps.writeAudit,
    };

    if (proposalPayload.resolutionType === "MANUAL_APPLY") {
      const evidence = extractCaseOpenedEvidence(events);
      await validateManualApplyTarget(deps.invoiceSettlementRepository, scoped, {
        targetInvoiceId: proposalPayload.targetInvoiceId!,
        settlementValuedAmount: evidence?.settlement.valuedAmount ?? null,
        exchangeAccountId: caseView.exchangeAccountId,
      });

      const applicationPayload = buildSettlementApplicationPayload({
        settlementId: caseView.settlementId,
        organizationId: scoped.organizationId,
        invoiceId: proposalPayload.targetInvoiceId!,
        appliedAmount: proposalPayload.projectedImpact.appliedAmount!,
        invoiceStatusAfter: "PAID",
      });

      const applied = await applySettlementApplication(applyDeps, scoped, {
        applicationPayload,
        applicationSource: "MANUAL",
        reconciliationCaseId: caseView.id,
        decisionId: input.decisionId,
        paymentId: caseView.paymentId,
        exchangeAccountId: caseView.exchangeAccountId,
        now,
      });

      settlementApplicationRef = {
        applicationId: applied.applicationId,
        settlementId: caseView.settlementId,
        invoiceId: applied.invoiceId,
        appliedAmount: applied.appliedAmount,
      };

      await deps.writeAudit({
        actorType: operator.actorType,
        actorId: operator.actorId,
        action: traderAuditActions.settlementReconciliationManualApplied,
        entityType: traderEntityTypes.settlement,
        entityId: caseView.settlementId,
        organizationId: scoped.organizationId,
        metadata: {
          caseId: caseView.id,
          decisionId: input.decisionId,
          ...settlementApplicationRef,
        },
      });
    }

    const event = buildWorkflowEventPayload(
      caseView,
      scoped.organizationId,
      RECONCILIATION_EVENT_RESOLUTION_EXECUTED,
      operator.actorType,
      operator.actorId,
      {
        decisionId: input.decisionId,
        proposalRef: {
          seq: liveProposal.seq,
          digest: liveProposal.recordContentDigest,
        },
        resolutionType: proposalPayload.resolutionType,
        settlementApplicationRef,
        effectiveAt: now.toISOString(),
        idempotencyKey: input.idempotencyKey,
      },
    );

    const result = await deps.caseRepository.appendEvent(scoped, {
      caseId: input.caseId,
      expectedLastEventSeq: input.expectedLastEventSeq,
      event,
      projection: {
        status: nextStatus,
        resolutionType: proposalPayload.resolutionType,
        currentDecisionId: input.decisionId,
        coolingOffUntil: null,
        assignedTo: null,
        claimExpiresAt: null,
        resolvedAt: now,
        lastEventSeq: event.seq,
        lastEventDigest: event.recordContentDigest,
      },
    });

    const resolutionAuditAction =
      proposalPayload.resolutionType === "MANUAL_APPLY"
        ? traderAuditActions.settlementReconciliationResolutionExecuted
        : proposalPayload.resolutionType === "WAIVE"
          ? traderAuditActions.settlementReconciliationWaived
          : proposalPayload.resolutionType === "CLOSE_NO_ACTION"
            ? traderAuditActions.settlementReconciliationClosedNoAction
            : traderAuditActions.settlementReconciliationClosedDuplicate;

    await deps.writeAudit({
      actorType: operator.actorType,
      actorId: operator.actorId,
      action: resolutionAuditAction,
      entityType: traderEntityTypes.settlementReconciliationCase,
      entityId: input.caseId,
      organizationId: scoped.organizationId,
      metadata: {
        decisionId: input.decisionId,
        resolutionType: proposalPayload.resolutionType,
        effectiveAt: now.toISOString(),
        settlementApplicationRef,
        idempotencyKey: input.idempotencyKey,
      },
    });

    return result;
  });
}
