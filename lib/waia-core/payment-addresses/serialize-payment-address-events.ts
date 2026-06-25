import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/waia-core/payment-addresses/canonical-json";
import {
  AddressChainBrokenError,
  AddressDigestMismatchError,
} from "@/lib/waia-core/payment-addresses/payment-address.errors";
import {
  PAYMENT_ADDRESS_EVENT_SCHEMA_VERSION,
  type PaymentAddressEventDigestInput,
  type PaymentAddressEventRecordPayload,
  type PaymentAddressEventRecordView,
} from "@/lib/waia-core/payment-addresses/payment-address-events.types";

export type SerializedPaymentAddressEventDigestInput = {
  schemaVersion: typeof PAYMENT_ADDRESS_EVENT_SCHEMA_VERSION;
  organizationId: string;
  addressId: string;
  walletId: string | null;
  seq: number;
  eventType: PaymentAddressEventDigestInput["eventType"];
  network: PaymentAddressEventDigestInput["network"];
  address: string | null;
  subjectModule: PaymentAddressEventDigestInput["subjectModule"];
  subjectRef: string | null;
  bindingRef: string | null;
  reason: string | null;
  prevEventDigest: string | null;
};

export function serializePaymentAddressEventDigestInput(
  input: PaymentAddressEventDigestInput,
): SerializedPaymentAddressEventDigestInput {
  return {
    schemaVersion: PAYMENT_ADDRESS_EVENT_SCHEMA_VERSION,
    organizationId: input.organizationId,
    addressId: input.addressId,
    walletId: input.walletId,
    seq: input.seq,
    eventType: input.eventType,
    network: input.network,
    address: input.address,
    subjectModule: input.subjectModule,
    subjectRef: input.subjectRef,
    bindingRef: input.bindingRef,
    reason: input.reason,
    prevEventDigest: input.prevEventDigest,
  };
}

export function computePaymentAddressEventDigest(input: PaymentAddressEventDigestInput): string {
  const canonical = serializePaymentAddressEventDigestInput(input);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function buildPaymentAddressEventRecordPayload(
  input: PaymentAddressEventDigestInput,
): PaymentAddressEventRecordPayload {
  const recordContentDigest = computePaymentAddressEventDigest(input);
  return {
    ...input,
    schemaVersion: PAYMENT_ADDRESS_EVENT_SCHEMA_VERSION,
    recordContentDigest,
  };
}

export function verifyPaymentAddressEventDigest(payload: PaymentAddressEventRecordPayload): void {
  const eventId = `${payload.addressId}:${payload.seq}`;

  if (payload.schemaVersion !== PAYMENT_ADDRESS_EVENT_SCHEMA_VERSION) {
    throw new AddressDigestMismatchError(eventId);
  }

  const { recordContentDigest, schemaVersion: _schemaVersion, ...digestInput } = payload;
  const expected = computePaymentAddressEventDigest(digestInput);
  if (expected !== recordContentDigest) {
    throw new AddressDigestMismatchError(eventId);
  }
}

export function verifyPaymentAddressEventChain(events: PaymentAddressEventRecordView[]): void {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  let previous: PaymentAddressEventRecordView | null = null;

  for (const event of ordered) {
    verifyPaymentAddressEventDigest(event);

    if (previous === null) {
      if (event.seq !== 1 || event.prevEventDigest !== null) {
        throw new AddressChainBrokenError(event.addressId, event.seq);
      }
    } else {
      if (event.seq !== previous.seq + 1) {
        throw new AddressChainBrokenError(event.addressId, event.seq);
      }
      if (event.prevEventDigest !== previous.recordContentDigest) {
        throw new AddressChainBrokenError(event.addressId, event.seq);
      }
    }

    previous = event;
  }
}
