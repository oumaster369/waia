export {
  PAYMENT_ADDRESS_EVENT_SCHEMA_VERSION,
  KNOWN_PAYMENT_ADDRESS_NETWORKS,
  paymentAddressEventTypes,
  paymentAddressStatuses,
  paymentAddressSubjectModules,
  paymentWalletCustodyModels,
  paymentWalletKinds,
} from "@/lib/waia-core/payment-addresses/payment-address-events.types";
export type {
  KnownPaymentAddressNetwork,
  PaymentAddressEventDigestInput,
  PaymentAddressEventRecordPayload,
  PaymentAddressEventRecordView,
  PaymentAddressEventSchemaVersion,
  PaymentAddressEventType,
  PaymentAddressNetwork,
  PaymentAddressStatus,
  PaymentAddressSubjectModule,
  PaymentWalletControlModel,
  PaymentWalletCustodyModel,
  PaymentWalletKind,
  PaymentWalletView,
} from "@/lib/waia-core/payment-addresses/payment-address-events.types";

export type { PaymentAddressProjectionView } from "@/lib/waia-core/payment-addresses/payment-address-projection.types";

export {
  AddressAlreadyAssignedError,
  AddressAlreadyExistsError,
  AddressChainBrokenError,
  AddressDigestMismatchError,
  AddressIdempotencyConflictError,
  AddressNotFoundError,
  AddressOrgOwnershipMismatchError,
  IllegalAddressTransitionError,
} from "@/lib/waia-core/payment-addresses/payment-address.errors";

export {
  assertAddressTransitionAllowed,
  eventTypeToAddressStatus,
  isAddressActiveForAttribution,
  isTerminalAddressStatus,
} from "@/lib/waia-core/payment-addresses/payment-address-lifecycle.transitions";

export {
  buildPaymentAddressEventRecordPayload,
  computePaymentAddressEventDigest,
  serializePaymentAddressEventDigestInput,
  verifyPaymentAddressEventChain,
  verifyPaymentAddressEventDigest,
} from "@/lib/waia-core/payment-addresses/serialize-payment-address-events";

export { canonicalJsonString } from "@/lib/waia-core/payment-addresses/canonical-json";
