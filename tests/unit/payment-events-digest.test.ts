import { describe, expect, it } from "vitest";

import {
  buildPaymentEventRecordPayload,
  computePaymentEventDigest,
  PAYMENT_EVENT_SCHEMA_VERSION,
  PaymentChainBrokenError,
  PaymentDigestMismatchError,
  verifyPaymentEventChain,
  verifyPaymentEventDigest,
  type PaymentEventDigestInput,
} from "@/lib/waia-core/payments";

const OBSERVED_AT = new Date("2026-06-25T10:00:00.000Z");
const CONFIRMED_AT = new Date("2026-06-25T10:05:00.000Z");
const VALUATION_AT = new Date("2026-06-25T10:05:01.000Z");

const baseDigestInput = {
  organizationId: "00000000-0000-4000-8000-0000000312",
  paymentId: "00000000-0000-4000-8000-0000000312p1",
  seq: 1,
  eventType: "DETECTED" as const,
  direction: "INBOUND" as const,
  subjectModule: "trader" as const,
  subjectInvoiceId: "invoice-312",
  idempotencyKey: "detect-312-1",
  reason: null,
  paymentAddressId: null,
  settlement: null,
  prevEventDigest: null,
} satisfies PaymentEventDigestInput;

describe("payment event digest (DEE-312 S1)", () => {
  it("produces deterministic digest for identical immutable input", () => {
    const digestA = computePaymentEventDigest(baseDigestInput);
    const digestB = computePaymentEventDigest(baseDigestInput);
    expect(digestA).toMatch(/^[a-f0-9]{64}$/);
    expect(digestA).toBe(digestB);
  });

  it("changes digest when idempotencyKey changes", () => {
    const digestA = computePaymentEventDigest(baseDigestInput);
    const digestB = computePaymentEventDigest({
      ...baseDigestInput,
      idempotencyKey: "detect-312-2",
    });
    expect(digestA).not.toBe(digestB);
  });

  it("builds payload with matching recordContentDigest", () => {
    const payload = buildPaymentEventRecordPayload(baseDigestInput);
    expect(payload.schemaVersion).toBe(PAYMENT_EVENT_SCHEMA_VERSION);
    expect(payload.recordContentDigest).toBe(computePaymentEventDigest(baseDigestInput));
    expect(() => verifyPaymentEventDigest(payload)).not.toThrow();
  });

  it("rejects tampered recordContentDigest fail-closed", () => {
    const payload = buildPaymentEventRecordPayload(baseDigestInput);
    expect(() =>
      verifyPaymentEventDigest({
        ...payload,
        recordContentDigest: "f".repeat(64),
      }),
    ).toThrow(PaymentDigestMismatchError);
  });

  it("verifies hash chain across genesis and confirm events", () => {
    const genesisPayload = buildPaymentEventRecordPayload(baseDigestInput);
    const confirmPayload = buildPaymentEventRecordPayload({
      organizationId: baseDigestInput.organizationId,
      paymentId: baseDigestInput.paymentId,
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
        evidenceRef: "watcher://312",
      },
      prevEventDigest: genesisPayload.recordContentDigest,
    });

    const events = [
      {
        id: "event-1",
        createdAt: OBSERVED_AT,
        ...genesisPayload,
      },
      {
        id: "event-2",
        createdAt: CONFIRMED_AT,
        ...confirmPayload,
      },
    ];

    expect(() => verifyPaymentEventChain(events)).not.toThrow();
  });

  it("rejects broken hash chain when prevEventDigest mismatches", () => {
    const genesisPayload = buildPaymentEventRecordPayload(baseDigestInput);
    const confirmPayload = buildPaymentEventRecordPayload({
      ...baseDigestInput,
      seq: 2,
      eventType: "CONFIRMED",
      idempotencyKey: null,
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
      prevEventDigest: "deadbeef".repeat(8),
    });

    expect(() =>
      verifyPaymentEventChain([
        { id: "event-1", createdAt: OBSERVED_AT, ...genesisPayload },
        { id: "event-2", createdAt: CONFIRMED_AT, ...confirmPayload },
      ]),
    ).toThrow(PaymentChainBrokenError);
  });
});
