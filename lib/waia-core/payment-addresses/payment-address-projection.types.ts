import type {
  PaymentAddressNetwork,
  PaymentAddressStatus,
  PaymentAddressSubjectModule,
} from "@/lib/waia-core/payment-addresses/payment-address-events.types";

export type PaymentAddressProjectionView = {
  addressId: string;
  organizationId: string;
  walletId: string | null;
  network: PaymentAddressNetwork;
  address: string;
  status: PaymentAddressStatus;
  subjectModule: PaymentAddressSubjectModule | null;
  subjectRef: string | null;
  bindingRef: string | null;
  lastEventSeq: number;
  lastEventDigest: string;
  createdAt: Date;
  updatedAt: Date;
};
