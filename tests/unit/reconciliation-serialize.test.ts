import { describe, expect, it } from "vitest";

import { RECONCILIATION_EVENT_CASE_OPENED } from "@/lib/trader/settlement/reconciliation/reconciliation.events";
import {
  buildReconciliationEventPayload,
  computeReconciliationEventDigest,
  verifyReconciliationEventDigest,
} from "@/lib/trader/settlement/reconciliation/serialize-reconciliation";
import { ReconciliationDigestMismatchError } from "@/lib/trader/settlement/reconciliation/reconciliation.errors";

const BASE_EVIDENCE = {
  settlement: {
    id: "settlement-1",
    outcome: "EXCEPTION" as const,
    exceptionReason: "AMOUNT_MISMATCH",
    valuedAmount: "150.000000",
    valuationCurrency: "USD",
    settlementNetwork: "TRC-20",
    settlementTxHash: "tx-1",
    onChainAmount: "150.000000",
    asset: "USDT",
    exchangeAccountId: "acct-1",
    paymentId: "pay-1",
  },
  payment: {
    paymentId: "pay-1",
    settlementNetwork: "TRC-20",
    settlementAsset: "USDT",
    settlementAmount: "150.000000",
    settlementTxHash: "tx-1",
    transferIndex: 0,
  },
  invoiceCandidates: [],
  applications: [],
};

describe("reconciliation serialize", () => {
  it("computes stable digests for CASE_OPENED payloads", () => {
    const input = {
      organizationId: "org-1",
      caseId: "case-1",
      seq: 1,
      eventType: RECONCILIATION_EVENT_CASE_OPENED,
      actorType: "service" as const,
      actorId: null,
      payload: BASE_EVIDENCE,
      prevEventDigest: null,
    };
    const first = computeReconciliationEventDigest(input);
    const second = computeReconciliationEventDigest(input);
    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });

  it("verifies built payloads and rejects tampering", () => {
    const payload = buildReconciliationEventPayload({
      organizationId: "org-1",
      caseId: "case-1",
      seq: 1,
      eventType: RECONCILIATION_EVENT_CASE_OPENED,
      actorType: "service",
      actorId: null,
      payload: BASE_EVIDENCE,
      prevEventDigest: null,
    });
    verifyReconciliationEventDigest(payload);
    expect(() =>
      verifyReconciliationEventDigest({ ...payload, recordContentDigest: "deadbeef" }),
    ).toThrow(ReconciliationDigestMismatchError);
  });
});
