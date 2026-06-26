import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { traderInvoices, traderSettlementReconciliationEvents } from "@/db/schema";
import {
  createSqliteAccountStatusRepository,
  createSqliteInvoiceSettlementRepository,
} from "@/lib/trader/settlement/account-status-repository-sqlite";
import { cancelProposal } from "@/lib/trader/settlement/reconciliation/commands/cancel-proposal";
import { claimCase } from "@/lib/trader/settlement/reconciliation/commands/claim-case";
import { escalateExternal } from "@/lib/trader/settlement/reconciliation/commands/escalate-external";
import { executeResolution } from "@/lib/trader/settlement/reconciliation/commands/execute-resolution";
import { proposeResolution } from "@/lib/trader/settlement/reconciliation/commands/propose-resolution";
import { releaseCase } from "@/lib/trader/settlement/reconciliation/commands/release-case";
import { reopenFromEscalation } from "@/lib/trader/settlement/reconciliation/commands/reopen-from-escalation";
import { startReview } from "@/lib/trader/settlement/reconciliation/commands/start-review";
import { rebuildCaseProjection } from "@/lib/trader/settlement/reconciliation/fold-reconciliation-events";
import {
  ReconciliationCoolingOffNotElapsedError,
  ReconciliationStaleConcurrencyTokenError,
} from "@/lib/trader/settlement/reconciliation/reconciliation.errors";
import { createSqliteSettlementApplicationsRepository } from "@/lib/trader/settlement/settlement-applications-repository-sqlite";
import { buildSettlementApplicationPayload } from "@/lib/trader/settlement/serialize-settlement";
import { traderAuditActions } from "@/lib/trader/types";
import {
  advanceCaseToDecisionPending,
  countApplicationsForSettlement,
  countAuditsForCase,
  countEvents,
  executeManualApply,
  getSettlementOutcome,
  initReconciliationWorkflowSqliteDb,
  seedReconciliationWorkflowFixture,
  type ReconciliationWorkflowFixture,
} from "@/tests/helpers/reconciliation-workflow-fixture";

describe("reconciliation commands (sqlite)", () => {
  let fixture: ReconciliationWorkflowFixture;

  beforeAll(async () => {
    initReconciliationWorkflowSqliteDb();
    fixture = await seedReconciliationWorkflowFixture();
  });

  const operator = () => ({ actorType: "user" as const, actorId: fixture.operatorId });

  it("claim appends exactly one event and one audit", async () => {
    const fresh = await seedReconciliationWorkflowFixture();
    const beforeEvents = countEvents(fresh.db, fresh.caseId);
    const beforeAudits = countAuditsForCase(fresh.db, fresh.caseId);

    await claimCase(
      { caseRepository: fresh.caseRepository, writeAudit: fresh.writeAudit },
      fresh.context,
      operator(),
      {
        caseId: fresh.caseId,
        expectedLastEventSeq: 1,
        idempotencyKey: "cmd-claim-audit",
      },
    );

    expect(countEvents(fresh.db, fresh.caseId)).toBe(beforeEvents + 1);
    expect(countAuditsForCase(fresh.db, fresh.caseId)).toBe(beforeAudits + 1);
  });

  it("release and review each append one event and one audit", async () => {
    const fresh = await seedReconciliationWorkflowFixture();
    const claimed = await claimCase(
      { caseRepository: fresh.caseRepository, writeAudit: fresh.writeAudit },
      fresh.context,
      operator(),
      {
        caseId: fresh.caseId,
        expectedLastEventSeq: 1,
        idempotencyKey: "cmd-claim-release-review",
      },
    );

    const eventsBeforeReview = countEvents(fresh.db, fresh.caseId);
    const auditsBeforeReview = countAuditsForCase(fresh.db, fresh.caseId);

    await releaseCase(
      { caseRepository: fresh.caseRepository, writeAudit: fresh.writeAudit },
      fresh.context,
      operator(),
      {
        caseId: fresh.caseId,
        expectedLastEventSeq: claimed.case.lastEventSeq,
        idempotencyKey: "cmd-release-audit",
      },
    );
    expect(countEvents(fresh.db, fresh.caseId)).toBe(eventsBeforeReview + 1);
    expect(countAuditsForCase(fresh.db, fresh.caseId)).toBe(auditsBeforeReview + 1);

    const reopened = await claimCase(
      { caseRepository: fresh.caseRepository, writeAudit: fresh.writeAudit },
      fresh.context,
      operator(),
      {
        caseId: fresh.caseId,
        expectedLastEventSeq: eventsBeforeReview + 1,
        idempotencyKey: "cmd-reclaim",
      },
    );

    const eventsBeforeReview2 = countEvents(fresh.db, fresh.caseId);
    await startReview(
      { caseRepository: fresh.caseRepository, writeAudit: fresh.writeAudit },
      fresh.context,
      operator(),
      {
        caseId: fresh.caseId,
        expectedLastEventSeq: reopened.case.lastEventSeq,
        idempotencyKey: "cmd-review-audit",
      },
    );
    expect(countEvents(fresh.db, fresh.caseId)).toBe(eventsBeforeReview2 + 1);
  });

  it("propose, cancel, escalate, reopen, execute each append one event and one audit", async () => {
    const fresh = await seedReconciliationWorkflowFixture();
    const { caseView, decisionId } = await advanceCaseToDecisionPending(fresh, {
      coolingOffMs: 0,
    });
    const eventsAfterPropose = countEvents(fresh.db, fresh.caseId);
    const auditsAfterPropose = countAuditsForCase(fresh.db, fresh.caseId);
    expect(eventsAfterPropose).toBeGreaterThan(1);
    expect(auditsAfterPropose).toBeGreaterThan(1);

    const cancelled = await cancelProposal(
      { caseRepository: fresh.caseRepository, writeAudit: fresh.writeAudit },
      fresh.context,
      operator(),
      {
        caseId: fresh.caseId,
        expectedLastEventSeq: caseView.lastEventSeq,
        idempotencyKey: "cmd-cancel-audit",
        reason: "Changed mind",
      },
    );
    expect(countEvents(fresh.db, fresh.caseId)).toBe(eventsAfterPropose + 1);

    const reProposed = await proposeResolution(
      {
        caseRepository: fresh.caseRepository,
        invoiceSettlementRepository: createSqliteInvoiceSettlementRepository(fresh.db),
        writeAudit: fresh.writeAudit,
        now: () => new Date("2026-06-26T12:30:00.000Z"),
      },
      fresh.context,
      operator(),
      {
        caseId: fresh.caseId,
        expectedLastEventSeq: cancelled.case.lastEventSeq,
        idempotencyKey: "cmd-repropose",
        resolutionType: "WAIVE",
        rationale: "Waive after cancel",
        coolingOffMs: 0,
      },
    );

    const escalated = await escalateExternal(
      { caseRepository: fresh.caseRepository, writeAudit: fresh.writeAudit },
      fresh.context,
      operator(),
      {
        caseId: fresh.caseId,
        expectedLastEventSeq: reProposed.case.lastEventSeq,
        idempotencyKey: "cmd-escalate-audit",
        reason: "Need external review",
      },
    );
    expect(countEvents(fresh.db, fresh.caseId)).toBe(eventsAfterPropose + 4);

    const reopened = await reopenFromEscalation(
      { caseRepository: fresh.caseRepository, writeAudit: fresh.writeAudit },
      fresh.context,
      operator(),
      {
        caseId: fresh.caseId,
        expectedLastEventSeq: escalated.case.lastEventSeq,
        idempotencyKey: "cmd-reopen-audit",
        reason: "External review complete",
      },
    );

    const waiveProposed = await proposeResolution(
      {
        caseRepository: fresh.caseRepository,
        invoiceSettlementRepository: createSqliteInvoiceSettlementRepository(fresh.db),
        writeAudit: fresh.writeAudit,
        now: () => new Date("2026-06-26T14:00:00.000Z"),
      },
      fresh.context,
      operator(),
      {
        caseId: fresh.caseId,
        expectedLastEventSeq: reopened.case.lastEventSeq,
        idempotencyKey: "cmd-propose-waive-exec",
        resolutionType: "WAIVE",
        rationale: "Final waive",
        coolingOffMs: 0,
      },
    );
    const waiveDecisionId = waiveProposed.case.currentDecisionId!;

    const eventsBeforeExecute = countEvents(fresh.db, fresh.caseId);
    const auditsBeforeExecute = countAuditsForCase(fresh.db, fresh.caseId);

    await executeResolution(
      {
        caseRepository: fresh.caseRepository,
        settlementApplicationsRepository: createSqliteSettlementApplicationsRepository(fresh.db),
        invoiceSettlementRepository: createSqliteInvoiceSettlementRepository(fresh.db),
        accountStatusRepository: createSqliteAccountStatusRepository(fresh.db),
        writeAudit: fresh.writeAudit,
        now: () => new Date("2026-06-26T15:00:00.000Z"),
      },
      fresh.context,
      operator(),
      {
        caseId: fresh.caseId,
        expectedLastEventSeq: waiveProposed.case.lastEventSeq,
        idempotencyKey: "cmd-execute-waive-audit",
        decisionId: waiveDecisionId,
        confirmToken: "confirm-waive",
      },
    );

    expect(countEvents(fresh.db, fresh.caseId)).toBe(eventsBeforeExecute + 1);
    expect(countAuditsForCase(fresh.db, fresh.caseId)).toBe(auditsBeforeExecute + 1);
  });

  it("rejects duplicate claim idempotency without a second event", async () => {
    const fresh = await seedReconciliationWorkflowFixture();
    const input = {
      caseId: fresh.caseId,
      expectedLastEventSeq: 1,
      idempotencyKey: "idem-claim-dup",
    };
    const first = await claimCase(
      { caseRepository: fresh.caseRepository, writeAudit: fresh.writeAudit },
      fresh.context,
      operator(),
      input,
    );
    const eventsAfterFirst = countEvents(fresh.db, fresh.caseId);

    const second = await claimCase(
      { caseRepository: fresh.caseRepository, writeAudit: fresh.writeAudit },
      fresh.context,
      operator(),
      input,
    );

    expect(second.event.id).toBe(first.event.id);
    expect(countEvents(fresh.db, fresh.caseId)).toBe(eventsAfterFirst);
  });

  it("rejects stale concurrency token on claim", async () => {
    const fresh = await seedReconciliationWorkflowFixture();
    await expect(
      claimCase(
        { caseRepository: fresh.caseRepository, writeAudit: fresh.writeAudit },
        fresh.context,
        operator(),
        {
          caseId: fresh.caseId,
          expectedLastEventSeq: 0,
          idempotencyKey: "stale-claim",
        },
      ),
    ).rejects.toThrow(ReconciliationStaleConcurrencyTokenError);
  });

  it("rejects execute when cooling-off has not elapsed", async () => {
    const fresh = await seedReconciliationWorkflowFixture();
    const { caseView, decisionId } = await advanceCaseToDecisionPending(fresh, {
      coolingOffMs: 60_000,
      now: new Date("2026-06-26T12:00:00.000Z"),
    });

    await expect(
      executeManualApply(fresh, {
        caseView,
        decisionId,
        idempotencyKey: "cooling-off-block",
        now: new Date("2026-06-26T12:00:30.000Z"),
      }),
    ).rejects.toThrow(ReconciliationCoolingOffNotElapsedError);
  });

  it("duplicate execute idempotency returns same event without a second application", async () => {
    const fresh = await seedReconciliationWorkflowFixture();
    const { caseView, decisionId } = await advanceCaseToDecisionPending(fresh, { coolingOffMs: 0 });
    const input = {
      caseView,
      decisionId,
      idempotencyKey: "idem-execute-dup",
    };
    const first = await executeManualApply(fresh, input);
    const appsAfterFirst = countApplicationsForSettlement(fresh.db, fresh.settlementId);

    const second = await executeManualApply(fresh, input);
    expect(second.event.id).toBe(first.event.id);
    expect(countApplicationsForSettlement(fresh.db, fresh.settlementId)).toBe(appsAfterFirst);
    expect(getSettlementOutcome(fresh.db, fresh.settlementId)).toBe("EXCEPTION");
  });

  it("OPEN -> RESOLVED MANUAL_APPLY marks invoice PAID once", async () => {
    const fresh = await seedReconciliationWorkflowFixture();
    const { caseView, decisionId } = await advanceCaseToDecisionPending(fresh, { coolingOffMs: 0 });
    const result = await executeManualApply(fresh, {
      caseView,
      decisionId,
      idempotencyKey: "happy-manual-apply",
    });

    expect(result.case.status).toBe("RESOLVED");
    expect(countApplicationsForSettlement(fresh.db, fresh.settlementId)).toBe(1);
    expect(getSettlementOutcome(fresh.db, fresh.settlementId)).toBe("EXCEPTION");

    const invoice = fresh.db
      .select()
      .from(traderInvoices)
      .where(eq(traderInvoices.id, fresh.targetInvoiceId))
      .get();
    expect(invoice?.status).toBe("PAID");
  });

  it("fold replay reproduces stored projection fields", async () => {
    const fresh = await seedReconciliationWorkflowFixture();
    const { caseView } = await advanceCaseToDecisionPending(fresh, { coolingOffMs: 0 });
    const stored = await fresh.caseRepository.findById(fresh.context, fresh.caseId);
    expect(stored).not.toBeNull();

    const events = await fresh.caseRepository.listEventsForCase(fresh.context, fresh.caseId);
    const rebuilt = rebuildCaseProjection(
      {
        ...stored!,
        status: "OPEN",
        assignedTo: null,
        claimExpiresAt: null,
        coolingOffUntil: null,
        resolutionType: null,
        currentDecisionId: null,
        resolvedAt: null,
        lastEventSeq: 0,
        lastEventDigest: "",
      },
      events,
    );

    expect(rebuilt.status).toBe(caseView.status);
    expect(rebuilt.assignedTo).toBe(caseView.assignedTo);
    expect(rebuilt.coolingOffUntil?.toISOString()).toBe(caseView.coolingOffUntil?.toISOString());
    expect(rebuilt.resolutionType).toBe(caseView.resolutionType);
    expect(rebuilt.currentDecisionId).toBe(caseView.currentDecisionId);
    expect(rebuilt.lastEventSeq).toBe(caseView.lastEventSeq);
    expect(rebuilt.lastEventDigest).toBe(caseView.lastEventDigest);
  });

  it("digest chain is continuous for generated events", async () => {
    const fresh = await seedReconciliationWorkflowFixture();
    await advanceCaseToDecisionPending(fresh, { coolingOffMs: 0 });
    const events = await fresh.caseRepository.listEventsForCase(fresh.context, fresh.caseId);
    events.sort((a, b) => a.seq - b.seq);
    expect(events[0]?.prevEventDigest).toBeNull();
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i]?.prevEventDigest).toBe(events[i - 1]?.recordContentDigest);
    }
  });

  it("executeResolution propagates appendEvent fault after apply path begins", async () => {
    const fresh = await seedReconciliationWorkflowFixture();
    const { caseView, decisionId } = await advanceCaseToDecisionPending(fresh, { coolingOffMs: 0 });

    let applyCalled = false;
    const appsRepo = createSqliteSettlementApplicationsRepository(fresh.db);
    const realRepo = fresh.caseRepository;

    await expect(
      executeResolution(
        {
          caseRepository: {
            ...realRepo,
            appendEvent: async (...args) => {
              throw new Error("injected fault after apply");
            },
          },
          settlementApplicationsRepository: {
            ...appsRepo,
            insertApplication: async (ctx, input) => {
              applyCalled = true;
              return appsRepo.insertApplication(ctx, input);
            },
          },
          invoiceSettlementRepository: createSqliteInvoiceSettlementRepository(fresh.db),
          accountStatusRepository: createSqliteAccountStatusRepository(fresh.db),
          writeAudit: fresh.writeAudit,
        },
        fresh.context,
        operator(),
        {
          caseId: fresh.caseId,
          expectedLastEventSeq: caseView.lastEventSeq,
          idempotencyKey: "fault-inject-order",
          decisionId,
          confirmToken: "confirm",
        },
      ),
    ).rejects.toThrow("injected fault after apply");

    expect(applyCalled).toBe(true);
    expect(
      fresh.db
        .select()
        .from(traderSettlementReconciliationEvents)
        .where(eq(traderSettlementReconciliationEvents.caseId, fresh.caseId))
        .all()
        .some((row) => row.eventType === "RESOLUTION_EXECUTED"),
    ).toBe(false);
  });

  it("concurrent claim attempts — second operator loses with stale token", async () => {
    const fresh = await seedReconciliationWorkflowFixture();
    const opA = { actorType: "user" as const, actorId: "operator-a" };
    const opB = { actorType: "user" as const, actorId: "operator-b" };

    await claimCase(
      { caseRepository: fresh.caseRepository, writeAudit: fresh.writeAudit },
      fresh.context,
      opA,
      {
        caseId: fresh.caseId,
        expectedLastEventSeq: 1,
        idempotencyKey: "race-claim-a",
      },
    );

    await expect(
      claimCase(
        { caseRepository: fresh.caseRepository, writeAudit: fresh.writeAudit },
        fresh.context,
        opB,
        {
          caseId: fresh.caseId,
          expectedLastEventSeq: 1,
          idempotencyKey: "race-claim-b",
        },
      ),
    ).rejects.toThrow(ReconciliationStaleConcurrencyTokenError);
  });
});

describe("reconciliation commands — audit action mapping", () => {
  it("maps claim audit action constant", () => {
    expect(traderAuditActions.settlementReconciliationCaseClaimed).toBe(
      "trader.settlement_reconciliation.case_claimed",
    );
  });
});

describe("settlement application payload builder", () => {
  it("builds deterministic application payload for uniqueness tests", () => {
    const payload = buildSettlementApplicationPayload({
      settlementId: "settlement-x",
      organizationId: "org-x",
      invoiceId: "inv-x",
      appliedAmount: "1.00",
      invoiceStatusAfter: "PAID",
    });
    expect(payload.settlementId).toBe("settlement-x");
    expect(payload.recordContentDigest).toMatch(/^[a-f0-9]+$/);
  });
});
