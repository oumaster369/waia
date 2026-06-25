import type {
  PaymentAddressEventRecordPayload,
  PaymentAddressEventRecordView,
} from "@/lib/waia-core/payment-addresses/payment-address-events.types";
import { verifyPaymentAddressEventDigest } from "@/lib/waia-core/payment-addresses/serialize-payment-address-events";

type PaymentAddressEventRow = {
  id: string;
  addressId: string;
  walletId: string | null;
  organizationId: string;
  seq: number;
  eventType: PaymentAddressEventRecordPayload["eventType"];
  network: string;
  address: string | null;
  subjectModule: PaymentAddressEventRecordPayload["subjectModule"];
  subjectRef: string | null;
  bindingRef: string | null;
  reason: string | null;
  schemaVersion: string;
  recordContentDigest: string;
  prevEventDigest: string | null;
  createdAt: Date;
};

export function mapPaymentAddressEventRow(
  row: PaymentAddressEventRow,
): PaymentAddressEventRecordView {
  const view: PaymentAddressEventRecordView = {
    id: row.id,
    organizationId: row.organizationId,
    addressId: row.addressId,
    walletId: row.walletId,
    seq: row.seq,
    eventType: row.eventType,
    network: row.network,
    address: row.address,
    subjectModule: row.subjectModule,
    subjectRef: row.subjectRef,
    bindingRef: row.bindingRef,
    reason: row.reason,
    prevEventDigest: row.prevEventDigest,
    schemaVersion: row.schemaVersion as PaymentAddressEventRecordPayload["schemaVersion"],
    recordContentDigest: row.recordContentDigest,
    createdAt: row.createdAt,
  };
  verifyPaymentAddressEventDigest(view);
  return view;
}

export function paymentAddressEventPayloadToInsertValues(
  id: string,
  organizationId: string,
  payload: PaymentAddressEventRecordPayload,
  createdAt: Date,
) {
  return {
    id,
    addressId: payload.addressId,
    walletId: payload.walletId,
    organizationId,
    seq: payload.seq,
    eventType: payload.eventType,
    network: payload.network,
    address: payload.address,
    subjectModule: payload.subjectModule,
    subjectRef: payload.subjectRef,
    bindingRef: payload.bindingRef,
    reason: payload.reason,
    schemaVersion: payload.schemaVersion,
    recordContentDigest: payload.recordContentDigest,
    prevEventDigest: payload.prevEventDigest,
    createdAt,
  };
}
