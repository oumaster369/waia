import { describe, expect, it } from "vitest";

import {
  buildPaymentEventRecordPayload,
  foldPaymentEventsToProjection,
  type PaymentEventDigestInput,
} from "@/lib/waia-core/payments";

const OBSERVED_AT = new Date("2026-06-25T10:00:00.000Z");
const CONFIRMED_AT = new Date("2026-06-25T10:05:00.000Z");
const VALUATION_AT = new Date("2026-06-25T10:05:01.000Z");

function buildGenesisInput(): PaymentEventDigestInput {
  return {
    organizationId: "00000000-0000-4000-8000-0000000312",
    paymentId: "00000000-0000-4000-8000-0000000312p1",
    seq: 1,
    eventType: "DETECTED",
    direction: "INBOUND",
    subjectModule: "trader",
    subjectInvoiceId: "invoice-312",
    idempotencyKey: "detect-312-rebuild",
    reason: null,
    paymentAddressId: null,
    settlement: null,
    prevEventDigest: null,
  };
}

describe("payment projection rebuild (DEE-312 S1)", () => {
  it("folds DETECTED -> CONFIRMED into deterministic projection", () => {
    const genesisPayload = buildPaymentEventRecordPayload(buildGenesisInput());
    const confirmPayload = buildPaymentEventRecordPayload({
      organizationId: genesisPayload.organizationId,
      paymentId: genesisPayload.paymentId,
      seq: 2,
      eventType: "CONFIRMED",
      direction: "INBOUND",
      subjectModule: "trader",
      subjectInvoiceId: "invoice-312",
      idempotencyKey: null,
      reason: null,
      paymentAddressId: null,
      settlement: {
        settlementNetwork: "TRC20",
        settlementAsset: "USDT",
        settlementAmount: "150.00",
        settlementTxHash: "abc123",
        transferIndex: 0,
        confirmationsRequired: 20,
        confirmationsObserved: 20,
        blockHeight: "12345",
        observedAt: OBSERVED_AT,
        confirmedAt: CONFIRMED_AT,
        valuedAmountUsd: "150.00",
        valuationSource: "usdt_usd_peg.v1",
        valuationAt: VALUATION_AT,
        evidenceRef: null,
      },
      prevEventDigest: genesisPayload.recordContentDigest,
    });

    const projection = foldPaymentEventsToProjection([
      { id: "event-1", createdAt: OBSERVED_AT, ...genesisPayload },
      { id: "event-2", createdAt: CONFIRMED_AT, ...confirmPayload },
    ]);

    expect(projection).toMatchObject({
      paymentId: genesisPayload.paymentId,
      status: "CONFIRMED",
      settlementAmount: "150.00",
      settlementTxHash: "abc123",
      transferIndex: 0,
      lastEventSeq: 2,
      lastEventDigest: confirmPayload.recordContentDigest,
    });
  });

  it("folds DETECTED -> FAILED into terminal failed projection", () => {
    const genesisPayload = buildPaymentEventRecordPayload(buildGenesisInput());
    const failedPayload = buildPaymentEventRecordPayload({
      organizationId: genesisPayload.organizationId,
      paymentId: genesisPayload.paymentId,
      seq: 2,
      eventType: "FAILED",
      direction: "INBOUND",
      subjectModule: "trader",
      subjectInvoiceId: "invoice-312",
      idempotencyKey: null,
      reason: "DROPPED",
      paymentAddressId: null,
      settlement: null,
      prevEventDigest: genesisPayload.recordContentDigest,
    });

    const projection = foldPaymentEventsToProjection([
      { id: "event-1", createdAt: OBSERVED_AT, ...genesisPayload },
      { id: "event-2", createdAt: CONFIRMED_AT, ...failedPayload },
    ]);

    expect(projection?.status).toBe("FAILED");
    expect(projection?.settlementTxHash).toBeNull();
  });
});
