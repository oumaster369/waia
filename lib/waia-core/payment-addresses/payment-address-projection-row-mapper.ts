import type { PaymentAddressProjectionView } from "@/lib/waia-core/payment-addresses/payment-address-projection.types";

type PaymentAddressProjectionRow = {
  addressId: string;
  organizationId: string;
  walletId: string | null;
  network: string;
  address: string;
  status: PaymentAddressProjectionView["status"];
  subjectModule: PaymentAddressProjectionView["subjectModule"];
  subjectRef: string | null;
  bindingRef: string | null;
  lastEventSeq: number;
  lastEventDigest: string;
  createdAt: Date;
  updatedAt: Date;
};

export function mapPaymentAddressProjectionRow(
  row: PaymentAddressProjectionRow,
): PaymentAddressProjectionView {
  return {
    addressId: row.addressId,
    organizationId: row.organizationId,
    walletId: row.walletId,
    network: row.network,
    address: row.address,
    status: row.status,
    subjectModule: row.subjectModule,
    subjectRef: row.subjectRef,
    bindingRef: row.bindingRef,
    lastEventSeq: row.lastEventSeq,
    lastEventDigest: row.lastEventDigest,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function paymentAddressProjectionToUpsertValues(
  projection: PaymentAddressProjectionView,
  updatedAt: Date,
) {
  return {
    addressId: projection.addressId,
    organizationId: projection.organizationId,
    walletId: projection.walletId,
    network: projection.network,
    address: projection.address,
    status: projection.status,
    subjectModule: projection.subjectModule,
    subjectRef: projection.subjectRef,
    bindingRef: projection.bindingRef,
    lastEventSeq: projection.lastEventSeq,
    lastEventDigest: projection.lastEventDigest,
    createdAt: projection.createdAt,
    updatedAt,
  };
}
