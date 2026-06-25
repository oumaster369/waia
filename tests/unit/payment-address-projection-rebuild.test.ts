import { describe, expect, it } from "vitest";

import {
  AddressChainBrokenError,
  AddressDigestMismatchError,
  buildPaymentAddressEventRecordPayload,
  foldPaymentAddressEventsToProjection,
  IllegalAddressTransitionError,
  type PaymentAddressEventDigestInput,
  type PaymentAddressEventRecordView,
} from "@/lib/waia-core/payment-addresses";

const CREATED_AT_1 = new Date("2026-06-25T10:00:00.000Z");
const CREATED_AT_2 = new Date("2026-06-25T10:05:00.000Z");
const CREATED_AT_3 = new Date("2026-06-25T10:10:00.000Z");
const CREATED_AT_4 = new Date("2026-06-25T10:15:00.000Z");
const CREATED_AT_5 = new Date("2026-06-25T10:20:00.000Z");
const CREATED_AT_6 = new Date("2026-06-25T10:25:00.000Z");

const WALLET_ID = "00000000-0000-4000-8000-0000000316w1";
const ORG_ID = "00000000-0000-4000-8000-0000000316";
const ADDRESS_ID = "00000000-0000-4000-8000-0000000316a1";

function buildGenesisInput(
  overrides: Partial<PaymentAddressEventDigestInput> = {},
): PaymentAddressEventDigestInput {
  return {
    organizationId: ORG_ID,
    addressId: ADDRESS_ID,
    walletId: WALLET_ID,
    seq: 1,
    eventType: "GENERATED",
    network: "TRC-20",
    address: "TExampleAddress316",
    subjectModule: null,
    subjectRef: null,
    bindingRef: null,
    reason: null,
    prevEventDigest: null,
    ...overrides,
  };
}

function toRecordView(
  id: string,
  createdAt: Date,
  payload: ReturnType<typeof buildPaymentAddressEventRecordPayload>,
): PaymentAddressEventRecordView {
  return { id, createdAt, ...payload };
}

describe("payment address projection rebuild (DEE-316 S2-C)", () => {
  it("folds a genesis GENERATED event into a projection", () => {
    const genesisPayload = buildPaymentAddressEventRecordPayload(buildGenesisInput());
    const projection = foldPaymentAddressEventsToProjection([
      toRecordView("event-1", CREATED_AT_1, genesisPayload),
    ]);

    expect(projection).toMatchObject({
      addressId: ADDRESS_ID,
      organizationId: ORG_ID,
      status: "GENERATED",
      network: "TRC-20",
      address: "TExampleAddress316",
      walletId: WALLET_ID,
      lastEventSeq: 1,
      lastEventDigest: genesisPayload.recordContentDigest,
    });
  });

  it("folds GENERATED -> ASSIGNED -> ACTIVATED with carried binding", () => {
    const genesisPayload = buildPaymentAddressEventRecordPayload(buildGenesisInput());
    const assignedPayload = buildPaymentAddressEventRecordPayload({
      organizationId: ORG_ID,
      addressId: ADDRESS_ID,
      walletId: WALLET_ID,
      seq: 2,
      eventType: "ASSIGNED",
      network: "TRC-20",
      address: null,
      subjectModule: "trader",
      subjectRef: "invoice-316",
      bindingRef: "bind-316",
      reason: null,
      prevEventDigest: genesisPayload.recordContentDigest,
    });
    const activatedPayload = buildPaymentAddressEventRecordPayload({
      organizationId: ORG_ID,
      addressId: ADDRESS_ID,
      walletId: WALLET_ID,
      seq: 3,
      eventType: "ACTIVATED",
      network: "TRC-20",
      address: null,
      subjectModule: "trader",
      subjectRef: "invoice-316",
      bindingRef: "bind-316",
      reason: null,
      prevEventDigest: assignedPayload.recordContentDigest,
    });

    const projection = foldPaymentAddressEventsToProjection([
      toRecordView("event-1", CREATED_AT_1, genesisPayload),
      toRecordView("event-2", CREATED_AT_2, assignedPayload),
      toRecordView("event-3", CREATED_AT_3, activatedPayload),
    ]);

    expect(projection).toMatchObject({
      status: "ACTIVATED",
      subjectModule: "trader",
      subjectRef: "invoice-316",
      bindingRef: "bind-316",
      lastEventSeq: 3,
      lastEventDigest: activatedPayload.recordContentDigest,
    });
  });

  it("folds GENERATED -> RESERVED -> RELEASED with null binding", () => {
    const genesisPayload = buildPaymentAddressEventRecordPayload(buildGenesisInput());
    const reservedPayload = buildPaymentAddressEventRecordPayload({
      organizationId: ORG_ID,
      addressId: ADDRESS_ID,
      walletId: WALLET_ID,
      seq: 2,
      eventType: "RESERVED",
      network: "TRC-20",
      address: null,
      subjectModule: null,
      subjectRef: null,
      bindingRef: null,
      reason: null,
      prevEventDigest: genesisPayload.recordContentDigest,
    });
    const releasedPayload = buildPaymentAddressEventRecordPayload({
      organizationId: ORG_ID,
      addressId: ADDRESS_ID,
      walletId: WALLET_ID,
      seq: 3,
      eventType: "RELEASED",
      network: "TRC-20",
      address: null,
      subjectModule: null,
      subjectRef: null,
      bindingRef: null,
      reason: null,
      prevEventDigest: reservedPayload.recordContentDigest,
    });

    const projection = foldPaymentAddressEventsToProjection([
      toRecordView("event-1", CREATED_AT_1, genesisPayload),
      toRecordView("event-2", CREATED_AT_2, reservedPayload),
      toRecordView("event-3", CREATED_AT_3, releasedPayload),
    ]);

    expect(projection?.status).toBe("RELEASED");
    expect(projection?.subjectRef).toBeNull();
  });

  it("folds ACTIVATED -> ROTATED -> RETIRED -> ARCHIVED", () => {
    const genesisPayload = buildPaymentAddressEventRecordPayload(buildGenesisInput());
    const assignedPayload = buildPaymentAddressEventRecordPayload({
      organizationId: ORG_ID,
      addressId: ADDRESS_ID,
      walletId: WALLET_ID,
      seq: 2,
      eventType: "ASSIGNED",
      network: "TRC-20",
      address: null,
      subjectModule: "trader",
      subjectRef: "invoice-316",
      bindingRef: null,
      reason: null,
      prevEventDigest: genesisPayload.recordContentDigest,
    });
    const activatedPayload = buildPaymentAddressEventRecordPayload({
      organizationId: ORG_ID,
      addressId: ADDRESS_ID,
      walletId: WALLET_ID,
      seq: 3,
      eventType: "ACTIVATED",
      network: "TRC-20",
      address: null,
      subjectModule: "trader",
      subjectRef: "invoice-316",
      bindingRef: null,
      reason: null,
      prevEventDigest: assignedPayload.recordContentDigest,
    });
    const rotatedPayload = buildPaymentAddressEventRecordPayload({
      organizationId: ORG_ID,
      addressId: ADDRESS_ID,
      walletId: WALLET_ID,
      seq: 4,
      eventType: "ROTATED",
      network: "TRC-20",
      address: null,
      subjectModule: "trader",
      subjectRef: "invoice-316",
      bindingRef: null,
      reason: null,
      prevEventDigest: activatedPayload.recordContentDigest,
    });
    const retiredPayload = buildPaymentAddressEventRecordPayload({
      organizationId: ORG_ID,
      addressId: ADDRESS_ID,
      walletId: WALLET_ID,
      seq: 5,
      eventType: "RETIRED",
      network: "TRC-20",
      address: null,
      subjectModule: "trader",
      subjectRef: "invoice-316",
      bindingRef: null,
      reason: null,
      prevEventDigest: rotatedPayload.recordContentDigest,
    });
    const archivedPayload = buildPaymentAddressEventRecordPayload({
      organizationId: ORG_ID,
      addressId: ADDRESS_ID,
      walletId: WALLET_ID,
      seq: 6,
      eventType: "ARCHIVED",
      network: "TRC-20",
      address: null,
      subjectModule: "trader",
      subjectRef: "invoice-316",
      bindingRef: null,
      reason: null,
      prevEventDigest: retiredPayload.recordContentDigest,
    });

    const projection = foldPaymentAddressEventsToProjection([
      toRecordView("event-1", CREATED_AT_1, genesisPayload),
      toRecordView("event-2", CREATED_AT_2, assignedPayload),
      toRecordView("event-3", CREATED_AT_3, activatedPayload),
      toRecordView("event-4", CREATED_AT_4, rotatedPayload),
      toRecordView("event-5", CREATED_AT_5, retiredPayload),
      toRecordView("event-6", CREATED_AT_6, archivedPayload),
    ]);

    expect(projection?.status).toBe("ARCHIVED");
  });

  it("folds ACTIVATED -> RECOVERED -> ACTIVATED", () => {
    const genesisPayload = buildPaymentAddressEventRecordPayload(buildGenesisInput());
    const assignedPayload = buildPaymentAddressEventRecordPayload({
      organizationId: ORG_ID,
      addressId: ADDRESS_ID,
      walletId: WALLET_ID,
      seq: 2,
      eventType: "ASSIGNED",
      network: "TRC-20",
      address: null,
      subjectModule: "trader",
      subjectRef: "invoice-316",
      bindingRef: null,
      reason: null,
      prevEventDigest: genesisPayload.recordContentDigest,
    });
    const activatedPayload = buildPaymentAddressEventRecordPayload({
      organizationId: ORG_ID,
      addressId: ADDRESS_ID,
      walletId: WALLET_ID,
      seq: 3,
      eventType: "ACTIVATED",
      network: "TRC-20",
      address: null,
      subjectModule: "trader",
      subjectRef: "invoice-316",
      bindingRef: null,
      reason: null,
      prevEventDigest: assignedPayload.recordContentDigest,
    });
    const recoveredPayload = buildPaymentAddressEventRecordPayload({
      organizationId: ORG_ID,
      addressId: ADDRESS_ID,
      walletId: WALLET_ID,
      seq: 4,
      eventType: "RECOVERED",
      network: "TRC-20",
      address: null,
      subjectModule: "trader",
      subjectRef: "invoice-316",
      bindingRef: null,
      reason: null,
      prevEventDigest: activatedPayload.recordContentDigest,
    });
    const reactivatedPayload = buildPaymentAddressEventRecordPayload({
      organizationId: ORG_ID,
      addressId: ADDRESS_ID,
      walletId: WALLET_ID,
      seq: 5,
      eventType: "ACTIVATED",
      network: "TRC-20",
      address: null,
      subjectModule: "trader",
      subjectRef: "invoice-316",
      bindingRef: null,
      reason: null,
      prevEventDigest: recoveredPayload.recordContentDigest,
    });

    const projection = foldPaymentAddressEventsToProjection([
      toRecordView("event-1", CREATED_AT_1, genesisPayload),
      toRecordView("event-2", CREATED_AT_2, assignedPayload),
      toRecordView("event-3", CREATED_AT_3, activatedPayload),
      toRecordView("event-4", CREATED_AT_4, recoveredPayload),
      toRecordView("event-5", CREATED_AT_5, reactivatedPayload),
    ]);

    expect(projection?.status).toBe("ACTIVATED");
  });

  it("returns null for empty events", () => {
    expect(foldPaymentAddressEventsToProjection([])).toBeNull();
  });

  it("throws AddressDigestMismatchError on tampered digest", () => {
    const genesisPayload = buildPaymentAddressEventRecordPayload(buildGenesisInput());
    expect(() =>
      foldPaymentAddressEventsToProjection([
        toRecordView("event-1", CREATED_AT_1, {
          ...genesisPayload,
          recordContentDigest: "0".repeat(64),
        }),
      ]),
    ).toThrow(AddressDigestMismatchError);
  });

  it("throws AddressChainBrokenError on seq gap", () => {
    const genesisPayload = buildPaymentAddressEventRecordPayload(buildGenesisInput());
    const gapPayload = buildPaymentAddressEventRecordPayload({
      organizationId: ORG_ID,
      addressId: ADDRESS_ID,
      walletId: WALLET_ID,
      seq: 3,
      eventType: "RESERVED",
      network: "TRC-20",
      address: null,
      subjectModule: null,
      subjectRef: null,
      bindingRef: null,
      reason: null,
      prevEventDigest: genesisPayload.recordContentDigest,
    });

    expect(() =>
      foldPaymentAddressEventsToProjection([
        toRecordView("event-1", CREATED_AT_1, genesisPayload),
        toRecordView("event-3", CREATED_AT_3, gapPayload),
      ]),
    ).toThrow(AddressChainBrokenError);
  });

  it("throws IllegalAddressTransitionError on digest-valid illegal lifecycle", () => {
    const genesisPayload = buildPaymentAddressEventRecordPayload(buildGenesisInput());
    const activatedPayload = buildPaymentAddressEventRecordPayload({
      organizationId: ORG_ID,
      addressId: ADDRESS_ID,
      walletId: WALLET_ID,
      seq: 2,
      eventType: "ACTIVATED",
      network: "TRC-20",
      address: null,
      subjectModule: "trader",
      subjectRef: "invoice-316",
      bindingRef: null,
      reason: null,
      prevEventDigest: genesisPayload.recordContentDigest,
    });

    expect(() =>
      foldPaymentAddressEventsToProjection([
        toRecordView("event-1", CREATED_AT_1, genesisPayload),
        toRecordView("event-2", CREATED_AT_2, activatedPayload),
      ]),
    ).toThrow(IllegalAddressTransitionError);
  });

  it("throws when genesis address is null", () => {
    const genesisPayload = buildPaymentAddressEventRecordPayload(
      buildGenesisInput({ address: null }),
    );

    expect(() =>
      foldPaymentAddressEventsToProjection([toRecordView("event-1", CREATED_AT_1, genesisPayload)]),
    ).toThrow("[waia-core] payment address projection fold failed: genesis address missing");
  });

  it("folds deterministically for identical input", () => {
    const genesisPayload = buildPaymentAddressEventRecordPayload(buildGenesisInput());
    const events = [toRecordView("event-1", CREATED_AT_1, genesisPayload)];
    const first = foldPaymentAddressEventsToProjection(events);
    const second = foldPaymentAddressEventsToProjection(events);
    expect(first).toEqual(second);
  });
});
