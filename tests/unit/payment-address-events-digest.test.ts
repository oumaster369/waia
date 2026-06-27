import { describe, expect, it } from "vitest";

import {
  AddressChainBrokenError,
  AddressDigestMismatchError,
  buildPaymentAddressEventRecordPayload,
  computePaymentAddressEventDigest,
  PAYMENT_ADDRESS_EVENT_SCHEMA_VERSION,
  verifyPaymentAddressEventChain,
  verifyPaymentAddressEventDigest,
  type PaymentAddressEventDigestInput,
  type PaymentAddressEventRecordView,
} from "@/lib/waia-core/payment-addresses";

const CREATED_AT_1 = new Date("2026-06-25T10:00:00.000Z");
const CREATED_AT_2 = new Date("2026-06-25T10:05:00.000Z");

const baseDigestInput = {
  organizationId: "00000000-0000-4000-8000-0000000314",
  addressId: "00000000-0000-4000-8000-0000000314a1",
  walletId: "00000000-0000-4000-8000-0000000314w1",
  seq: 1,
  eventType: "GENERATED" as const,
  network: "TRC-20",
  address: "TExampleAddress314",
  subjectModule: null,
  subjectRef: null,
  bindingRef: null,
  reason: null,
  prevEventDigest: null,
} satisfies PaymentAddressEventDigestInput;

describe("payment address event digest (DEE-314 S2-B)", () => {
  it("produces deterministic digest for identical immutable input", () => {
    const digestA = computePaymentAddressEventDigest(baseDigestInput);
    const digestB = computePaymentAddressEventDigest(baseDigestInput);
    expect(digestA).toMatch(/^[a-f0-9]{64}$/);
    expect(digestA).toBe(digestB);
  });

  it.each([
    ["subjectRef", { subjectRef: "invoice-314" }],
    ["bindingRef", { bindingRef: "binding-314" }],
    ["network", { network: "ERC-20" }],
    ["address", { address: "TChangedAddress314" }],
    ["walletId", { walletId: "00000000-0000-4000-8000-0000000314w2" }],
    ["reason", { reason: "manual-release" }],
    ["eventType", { eventType: "RESERVED" as const }],
    ["seq", { seq: 2 }],
  ] as const)("changes digest when %s changes", (_field, override) => {
    const digestA = computePaymentAddressEventDigest(baseDigestInput);
    const digestB = computePaymentAddressEventDigest({ ...baseDigestInput, ...override });
    expect(digestA).not.toBe(digestB);
  });

  it("digest ignores intentionally excluded id and createdAt on record view", () => {
    const payload = buildPaymentAddressEventRecordPayload(baseDigestInput);
    const viewA: PaymentAddressEventRecordView = {
      id: "event-a",
      createdAt: CREATED_AT_1,
      ...payload,
    };
    const viewB: PaymentAddressEventRecordView = {
      id: "event-b",
      createdAt: CREATED_AT_2,
      ...payload,
    };
    expect(viewA.recordContentDigest).toBe(viewB.recordContentDigest);
  });

  it("builds payload with matching schemaVersion and recordContentDigest", () => {
    const payload = buildPaymentAddressEventRecordPayload(baseDigestInput);
    expect(payload.schemaVersion).toBe(PAYMENT_ADDRESS_EVENT_SCHEMA_VERSION);
    expect(payload.recordContentDigest).toBe(computePaymentAddressEventDigest(baseDigestInput));
    expect(() => verifyPaymentAddressEventDigest(payload)).not.toThrow();
  });

  it("verifies genesis event with seq 1 and prevEventDigest null", () => {
    const payload = buildPaymentAddressEventRecordPayload(baseDigestInput);
    expect(payload.seq).toBe(1);
    expect(payload.prevEventDigest).toBeNull();
    expect(() => verifyPaymentAddressEventDigest(payload)).not.toThrow();
  });

  it("verifies hash chain across GENERATED and ASSIGNED events", () => {
    const genesisPayload = buildPaymentAddressEventRecordPayload(baseDigestInput);
    const assignedPayload = buildPaymentAddressEventRecordPayload({
      ...baseDigestInput,
      seq: 2,
      eventType: "ASSIGNED",
      subjectModule: "trader",
      subjectRef: "invoice-314",
      bindingRef: "bind-314",
      prevEventDigest: genesisPayload.recordContentDigest,
    });

    const events: PaymentAddressEventRecordView[] = [
      { id: "event-1", createdAt: CREATED_AT_1, ...genesisPayload },
      { id: "event-2", createdAt: CREATED_AT_2, ...assignedPayload },
    ];

    expect(() => verifyPaymentAddressEventChain(events)).not.toThrow();
  });

  it("rejects tampered recordContentDigest fail-closed", () => {
    const payload = buildPaymentAddressEventRecordPayload(baseDigestInput);
    expect(() =>
      verifyPaymentAddressEventDigest({
        ...payload,
        recordContentDigest: "f".repeat(64),
      }),
    ).toThrow(AddressDigestMismatchError);
  });

  it("rejects schemaVersion tamper even when digest fields are self-consistent", () => {
    const payload = buildPaymentAddressEventRecordPayload(baseDigestInput);
    expect(() =>
      verifyPaymentAddressEventDigest({
        ...payload,
        schemaVersion:
          "waia.core.payment-address-event.v0" as typeof PAYMENT_ADDRESS_EVENT_SCHEMA_VERSION,
      }),
    ).toThrow(AddressDigestMismatchError);
  });

  it("rejects broken hash chain when prevEventDigest mismatches", () => {
    const genesisPayload = buildPaymentAddressEventRecordPayload(baseDigestInput);
    const assignedPayload = buildPaymentAddressEventRecordPayload({
      ...baseDigestInput,
      seq: 2,
      eventType: "ASSIGNED",
      subjectModule: "trader",
      subjectRef: "invoice-314",
      bindingRef: null,
      prevEventDigest: "deadbeef".repeat(8),
    });

    expect(() =>
      verifyPaymentAddressEventChain([
        { id: "event-1", createdAt: CREATED_AT_1, ...genesisPayload },
        { id: "event-2", createdAt: CREATED_AT_2, ...assignedPayload },
      ]),
    ).toThrow(AddressChainBrokenError);
  });

  it("rejects seq gap [1,3] even when prevEventDigest links to seq1 digest", () => {
    const genesisPayload = buildPaymentAddressEventRecordPayload(baseDigestInput);
    const gapPayload = buildPaymentAddressEventRecordPayload({
      ...baseDigestInput,
      seq: 3,
      eventType: "ASSIGNED",
      subjectModule: "trader",
      subjectRef: "invoice-314",
      bindingRef: null,
      prevEventDigest: genesisPayload.recordContentDigest,
    });

    expect(() =>
      verifyPaymentAddressEventChain([
        { id: "event-1", createdAt: CREATED_AT_1, ...genesisPayload },
        { id: "event-3", createdAt: CREATED_AT_2, ...gapPayload },
      ]),
    ).toThrow(AddressChainBrokenError);
  });

  it("rejects genesis chain when first event seq is not 1", () => {
    const payload = buildPaymentAddressEventRecordPayload({
      ...baseDigestInput,
      seq: 2,
      prevEventDigest: null,
    });

    expect(() =>
      verifyPaymentAddressEventChain([{ id: "event-2", createdAt: CREATED_AT_1, ...payload }]),
    ).toThrow(AddressChainBrokenError);
  });

  it("rejects genesis chain when first event prevEventDigest is not null", () => {
    const payload = buildPaymentAddressEventRecordPayload({
      ...baseDigestInput,
      prevEventDigest: "deadbeef".repeat(8),
    });

    expect(() =>
      verifyPaymentAddressEventChain([{ id: "event-1", createdAt: CREATED_AT_1, ...payload }]),
    ).toThrow(AddressChainBrokenError);
  });

  it("changes digest when subjectRef flips from value to null", () => {
    const withRef = computePaymentAddressEventDigest({
      ...baseDigestInput,
      subjectRef: "invoice-314",
    });
    const withNull = computePaymentAddressEventDigest({
      ...baseDigestInput,
      subjectRef: null,
    });
    expect(withRef).not.toBe(withNull);
  });
});
