import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import {
  assertReconciliationTransitionAllowed,
  reconciliationCommands,
} from "@/lib/trader/settlement/reconciliation/reconciliation.transitions";
import { buildWorkflowEventPayload } from "@/lib/trader/settlement/reconciliation/reconciliation-command.helpers";
import type { ReconciliationCaseRepository } from "@/lib/trader/settlement/reconciliation/reconciliation-case-repository.types";
import { findEventByIdempotencyKey } from "@/lib/trader/settlement/reconciliation/fold-reconciliation-events";
import { RECONCILIATION_EVENT_CLAIM_EXPIRED } from "@/lib/trader/settlement/reconciliation/reconciliation.events";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

export type ReconciliationSweeperReport = {
  processed: number;
  expired: number;
  skipped: number;
};

export type RunReconciliationSweeperDeps = {
  caseRepository: ReconciliationCaseRepository;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
  now?: () => Date;
};

export async function runReconciliationSweeper(
  deps: RunReconciliationSweeperDeps,
  context: OrgContext,
): Promise<ReconciliationSweeperReport> {
  const scoped = requireOrgContext(context.organizationId);
  const now = deps.now?.() ?? new Date();
  const expiredCases = await deps.caseRepository.listClaimExpired(scoped, now);

  let expired = 0;
  let skipped = 0;

  for (const caseView of expiredCases) {
    if (!caseView.assignedTo || !caseView.claimExpiresAt) {
      skipped += 1;
      continue;
    }

    const idempotencyKey = `claim-expired:${caseView.id}:${caseView.claimExpiresAt.toISOString()}`;
    const events = await deps.caseRepository.listEventsForCase(scoped, caseView.id);
    if (findEventByIdempotencyKey(events, idempotencyKey)) {
      skipped += 1;
      continue;
    }

    assertReconciliationTransitionAllowed(
      caseView.id,
      caseView.status,
      reconciliationCommands.expireClaim,
    );

    const event = buildWorkflowEventPayload(
      caseView,
      scoped.organizationId,
      RECONCILIATION_EVENT_CLAIM_EXPIRED,
      "system",
      null,
      {
        expiredAssignee: caseView.assignedTo,
        claimExpiresAt: caseView.claimExpiresAt.toISOString(),
        idempotencyKey,
      },
    );

    await deps.caseRepository.appendEvent(scoped, {
      caseId: caseView.id,
      expectedLastEventSeq: caseView.lastEventSeq,
      event,
      projection: {
        status: "OPEN",
        assignedTo: null,
        claimExpiresAt: null,
        lastEventSeq: event.seq,
        lastEventDigest: event.recordContentDigest,
      },
    });

    await deps.writeAudit({
      actorType: "system",
      actorId: null,
      action: traderAuditActions.settlementReconciliationClaimExpired,
      entityType: traderEntityTypes.settlementReconciliationCase,
      entityId: caseView.id,
      organizationId: scoped.organizationId,
      metadata: {
        expiredAssignee: caseView.assignedTo,
        claimExpiresAt: caseView.claimExpiresAt.toISOString(),
        idempotencyKey,
      },
    });

    expired += 1;
  }

  return {
    processed: expiredCases.length,
    expired,
    skipped,
  };
}
