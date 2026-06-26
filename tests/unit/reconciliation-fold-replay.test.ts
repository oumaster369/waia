import { describe, expect, it } from "vitest";

import {
  foldReconciliationEvents,
  rebuildCaseProjection,
} from "@/lib/trader/settlement/reconciliation/fold-reconciliation-events";
import { buildCaseOpenedEventPayload } from "@/lib/trader/settlement/reconciliation/reconciliation.events";
import {
  RECONCILIATION_EVENT_CASE_CLAIMED,
  RECONCILIATION_EVENT_CASE_OPENED,
  RECONCILIATION_EVENT_REVIEW_STARTED,
} from "@/lib/trader/settlement/reconciliation/reconciliation.events";
import { buildReconciliationEventPayload } from "@/lib/trader/settlement/reconciliation/serialize-reconciliation";
import {
  inlineEvidenceValue,
  RECONCILIATION_EVIDENCE_SNAPSHOT_SCHEMA_VERSION,
  type ReconciliationCaseView,
} from "@/lib/trader/settlement/reconciliation/reconciliation.types";

const evidenceSnapshot = {
  schemaVersion: RECONCILIATION_EVIDENCE_SNAPSHOT_SCHEMA_VERSION,
  settlement: {
    id: "settlement-1",
    outcome: "EXCEPTION" as const,
    exceptionReason: "AMOUNT_MISMATCH",
    valuedAmount: "100.00",
    valuationCurrency: "USD",
    settlementNetwork: "tron",
    settlementTxHash: "abc",
    onChainAmount: "100.00",
    asset: "USDT",
    exchangeAccountId: "acct-1",
    paymentId: "payment-1",
  },
  payment: inlineEvidenceValue({
    paymentId: "payment-1",
    settlementNetwork: "tron",
    settlementAsset: "USDT",
    settlementAmount: "100.00",
    settlementTxHash: "abc",
    transferIndex: 0,
  }),
  invoiceCandidates: inlineEvidenceValue([]),
  applications: inlineEvidenceValue([]),
};

function event(seq: number, eventType: string, payload: unknown, prev: string | null) {
  return {
    id: `evt-${seq}`,
    ...buildReconciliationEventPayload({
      organizationId: "org-1",
      caseId: "case-1",
      seq,
      eventType,
      actorType: "user" as const,
      actorId: "operator-1",
      payload: payload as never,
      prevEventDigest: prev,
    }),
    createdAt: new Date(`2026-01-0${seq}T00:00:00Z`),
  };
}

describe("fold-reconciliation-events", () => {
  it("folds claim and review transitions", () => {
    const opened = event(
      1,
      RECONCILIATION_EVENT_CASE_OPENED,
      buildCaseOpenedEventPayload({
        evidenceSnapshot,
        exceptionReason: "AMOUNT_MISMATCH",
        priority: 10,
      }),
      null,
    );
    const claimed = event(
      2,
      RECONCILIATION_EVENT_CASE_CLAIMED,
      {
        assignedTo: "operator-1",
        claimExpiresAt: "2026-01-02T00:00:00Z",
        idempotencyKey: "claim-1",
      },
      opened.recordContentDigest,
    );
    const review = event(
      3,
      RECONCILIATION_EVENT_REVIEW_STARTED,
      { idempotencyKey: "review-1" },
      claimed.recordContentDigest,
    );

    const folded = foldReconciliationEvents([opened, claimed, review], {
      priority: 10,
      exceptionReason: "AMOUNT_MISMATCH",
      openedAt: new Date("2026-01-01T00:00:00Z"),
    });

    expect(folded.status).toBe("UNDER_REVIEW");
    expect(folded.assignedTo).toBe("operator-1");
    expect(folded.lastEventSeq).toBe(3);
  });

  it("rebuildCaseProjection matches folded state", () => {
    const baseCase: ReconciliationCaseView = {
      id: "case-1",
      organizationId: "org-1",
      settlementId: "settlement-1",
      paymentId: "payment-1",
      exchangeAccountId: "acct-1",
      exceptionReason: "AMOUNT_MISMATCH",
      status: "OPEN",
      priority: 10,
      resolutionType: null,
      currentDecisionId: null,
      assignedTo: null,
      claimExpiresAt: null,
      coolingOffUntil: null,
      openedAt: new Date("2026-01-01T00:00:00Z"),
      resolvedAt: null,
      lastEventSeq: 1,
      lastEventDigest: "digest-1",
    };
    const opened = event(
      1,
      RECONCILIATION_EVENT_CASE_OPENED,
      buildCaseOpenedEventPayload({
        evidenceSnapshot,
        exceptionReason: "AMOUNT_MISMATCH",
        priority: 10,
      }),
      null,
    );
    const rebuilt = rebuildCaseProjection(baseCase, [opened]);
    expect(rebuilt.status).toBe("OPEN");
    expect(rebuilt.lastEventSeq).toBe(1);
  });
});
