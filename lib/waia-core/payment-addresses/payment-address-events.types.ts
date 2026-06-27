import {
  paymentAddressEventTypeEnum,
  paymentAddressStatusEnum,
  paymentSubjectModuleEnum,
  paymentWalletCustodyModelEnum,
  paymentWalletKindEnum,
} from "@/db/core-enums";

export const PAYMENT_ADDRESS_EVENT_SCHEMA_VERSION = "waia.core.payment-address-event.v1" as const;

export type PaymentAddressEventSchemaVersion = typeof PAYMENT_ADDRESS_EVENT_SCHEMA_VERSION;

export const paymentAddressEventTypes = paymentAddressEventTypeEnum;
export type PaymentAddressEventType = (typeof paymentAddressEventTypes)[number];

export const paymentAddressStatuses = paymentAddressStatusEnum;
export type PaymentAddressStatus = (typeof paymentAddressStatuses)[number];

export const paymentAddressSubjectModules = paymentSubjectModuleEnum;
export type PaymentAddressSubjectModule = (typeof paymentAddressSubjectModules)[number];

export const paymentWalletKinds = paymentWalletKindEnum;
export type PaymentWalletKind = (typeof paymentWalletKinds)[number];

export const paymentWalletCustodyModels = paymentWalletCustodyModelEnum;
export type PaymentWalletCustodyModel = (typeof paymentWalletCustodyModels)[number];

export type PaymentAddressNetwork = string;

export const KNOWN_PAYMENT_ADDRESS_NETWORKS = ["TRC-20"] as const;
export type KnownPaymentAddressNetwork = (typeof KNOWN_PAYMENT_ADDRESS_NETWORKS)[number];

export type PaymentWalletControlModel = string;

export type PaymentWalletView = {
  id: string;
  organizationId: string;
  walletKind: PaymentWalletKind;
  custodyModel: PaymentWalletCustodyModel;
  controlModel: PaymentWalletControlModel;
  providerRef: string | null;
  derivationScheme: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export type PaymentAddressEventDigestInput = {
  organizationId: string;
  addressId: string;
  walletId: string | null;
  seq: number;
  eventType: PaymentAddressEventType;
  network: PaymentAddressNetwork;
  address: string | null;
  subjectModule: PaymentAddressSubjectModule | null;
  subjectRef: string | null;
  bindingRef: string | null;
  reason: string | null;
  prevEventDigest: string | null;
};

export type PaymentAddressEventRecordPayload = PaymentAddressEventDigestInput & {
  schemaVersion: PaymentAddressEventSchemaVersion;
  recordContentDigest: string;
};

export type PaymentAddressEventRecordView = PaymentAddressEventRecordPayload & {
  id: string;
  createdAt: Date;
};
