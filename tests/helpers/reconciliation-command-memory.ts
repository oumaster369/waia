import { expect, vi } from "vitest";

import type {
  AccountStatusRepository,
  InvoiceSettlementRepository,
} from "@/lib/trader/settlement/account-status-repository.types";
import type { ReconciliationCaseRepository } from "@/lib/trader/settlement/reconciliation/reconciliation-case-repository.types";
import {
  buildReconciliationEventPayload,
  verifyReconciliationEventDigest,
} from "@/lib/trader/settlement/reconciliation/serialize-reconciliation";
import type {
  ReconciliationCaseView,
  ReconciliationEventRecordView,
} from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import type { SettlementApplicationsRepository } from "@/lib/trader/settlement/settlements-repository.types";
import type { SettlementApplicationRecordView } from "@/lib/trader/settlement/settlement.types";
import type { TraderAuditInput } from "@/lib/trader/types";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";

export const RECONCILIATION_TEST_NOW = new Date("2026-01-01T00:00:00Z");
export const RECONCILIATION_TEST_USER = "00000000-0000-4000-8000-000000001117";

/** Inert repository ports; no database, payment source or production authority. */
export function createReconciliationCommandMemory(fee = "30", amount: string | null = "30.000000") {
  const context = { organizationId: personalOrganizationIdFromUserId(RECONCILIATION_TEST_USER) };
  const operator = { actorType: "user" as const, actorId: RECONCILIATION_TEST_USER };
  const caseId = "synthetic-reconciliation-case";
  const events: ReconciliationEventRecordView[] = [];
  function seedEvent(eventType: string, payload: unknown) {
    events.push({
      ...buildReconciliationEventPayload({
        organizationId: context.organizationId, caseId, seq: events.length + 1, eventType,
        actorType: operator.actorType, actorId: operator.actorId,
        payload: payload as ReconciliationEventRecordView["payload"],
        prevEventDigest: events.at(-1)?.recordContentDigest ?? null,
      }),
      id: `seed-event-${events.length + 1}`, createdAt: RECONCILIATION_TEST_NOW,
    });
  }
  seedEvent("CASE_OPENED", {
    evidenceSnapshot: {
      schemaVersion: "waia.trader.reconciliation-evidence.v1",
      settlement: {
        id: "synthetic-settlement", outcome: "EXCEPTION", exceptionReason: "MULTIPLE_CANDIDATE_INVOICES",
        valuedAmount: amount, valuationCurrency: "USD", settlementNetwork: "TRC-20",
        settlementTxHash: "synthetic-tx", onChainAmount: amount, asset: "USDT",
        exchangeAccountId: "synthetic-account", paymentId: "synthetic-payment",
      },
      payment: null, invoiceCandidates: { kind: "inline", value: [] },
      applications: { kind: "inline", value: [] },
    },
    exceptionReason: "MULTIPLE_CANDIDATE_INVOICES", priority: 1,
  });
  seedEvent("CASE_CLAIMED", {
    assignedTo: operator.actorId, claimExpiresAt: "2026-01-01T01:00:00Z", idempotencyKey: "seed-claim",
  });
  seedEvent("REVIEW_STARTED", { idempotencyKey: "seed-review" });
  let caseView: ReconciliationCaseView = {
    id: caseId, organizationId: context.organizationId, settlementId: "synthetic-settlement",
    paymentId: "synthetic-payment", exchangeAccountId: "synthetic-account",
    exceptionReason: "MULTIPLE_CANDIDATE_INVOICES", status: "UNDER_REVIEW", priority: 1,
    resolutionType: null, currentDecisionId: null, assignedTo: operator.actorId,
    claimExpiresAt: new Date("2026-01-01T01:00:00Z"), coolingOffUntil: null,
    openedAt: RECONCILIATION_TEST_NOW, resolvedAt: null, lastEventSeq: 3,
    lastEventDigest: events.at(-1)!.recordContentDigest,
  };
  const invoice = {
    id: "synthetic-invoice", organizationId: context.organizationId,
    exchangeAccountId: "synthetic-account", performanceFee: fee, status: "ISSUED",
    periodStart: RECONCILIATION_TEST_NOW, settledAmount: "0",
  };
  const caseRepository: ReconciliationCaseRepository = {
    findById: vi.fn(async (scope, id) => scope.organizationId === context.organizationId && id === caseId
      ? structuredClone(caseView) : null),
    findBySettlementId: vi.fn(async () => structuredClone(caseView)),
    listEventsForCase: vi.fn(async (scope, id) => {
      expect(scope.organizationId).toBe(context.organizationId); expect(id).toBe(caseId);
      return structuredClone(events);
    }),
    appendEvent: vi.fn(async (scope, input) => {
      expect(scope.organizationId).toBe(context.organizationId);
      expect(input.expectedLastEventSeq).toBe(caseView.lastEventSeq);
      verifyReconciliationEventDigest(input.event);
      const event = { ...input.event, id: `event-${input.event.seq}`, createdAt: new Date() };
      events.push(event); caseView = { ...caseView, ...input.projection };
      return { case: structuredClone(caseView), event };
    }),
    openCase: vi.fn(async () => { throw new Error("UNEXPECTED_OPEN"); }),
    listClaimExpired: vi.fn(async () => []),
  };
  const invoiceSettlementRepository: InvoiceSettlementRepository = {
    getInvoiceForSettlementLock: vi.fn(async () => ({ ...invoice })),
    listIssuedInvoicesForAccount: vi.fn(async () => [{ ...invoice }]),
    markInvoicePaid: vi.fn(async (scope, input) => {
      expect(scope.organizationId).toBe(context.organizationId); expect(input.invoiceId).toBe(invoice.id);
      invoice.status = "PAID"; invoice.settledAmount = input.settledAmount;
    }),
  };
  const applications: SettlementApplicationRecordView[] = [];
  const settlementApplicationsRepository: SettlementApplicationsRepository = {
    listBySettlementId: vi.fn(async () => structuredClone(applications)),
    insertApplication: vi.fn(async (scope, input) => {
      expect(scope.organizationId).toBe(context.organizationId);
      if (applications.length) throw new Error("DUPLICATE_SYNTHETIC_APPLICATION");
      const application = { ...input.payload, id: "synthetic-application", createdAt: new Date() };
      applications.push(application); return application;
    }),
  };
  const accountStatusRepository: AccountStatusRepository = {
    getProjection: vi.fn(async () => null),
    listEventsForAccount: vi.fn(async () => []),
    appendEventAndProjection: vi.fn(async () => { throw new Error("UNEXPECTED_REACTIVATION"); }),
  };
  const audits: TraderAuditInput[] = [];
  const writeAudit = vi.fn(async (input: TraderAuditInput) => {
    audits.push(structuredClone(input)); return `audit-${audits.length}`;
  });
  return {
    context, operator, caseId, invoice, events, applications, audits,
    caseRepository, invoiceSettlementRepository, settlementApplicationsRepository,
    accountStatusRepository, writeAudit,
    readCase: () => structuredClone(caseView),
  };
}
