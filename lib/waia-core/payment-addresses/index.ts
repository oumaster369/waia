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

export {
  paymentAddressAuditActions,
  paymentAddressEntityTypes,
} from "@/lib/waia-core/payment-addresses/payment-address.audit";
export type {
  PaymentAddressAuditAction,
  PaymentAddressEntityType,
} from "@/lib/waia-core/payment-addresses/payment-address.audit";

export {
  DEFAULT_PAYMENT_ADDRESS_EVENTS_LIST_LIMIT,
  MAX_PAYMENT_ADDRESS_EVENTS_LIST_LIMIT,
} from "@/lib/waia-core/payment-addresses/payment-address-events-repository.types";
export type {
  InsertPaymentAddressEventRepoInput,
  ListPaymentAddressEventsQuery,
  PaymentAddressEventsRepository,
} from "@/lib/waia-core/payment-addresses/payment-address-events-repository.types";

export {
  DEFAULT_PAYMENT_ADDRESSES_LIST_LIMIT,
  MAX_PAYMENT_ADDRESSES_LIST_LIMIT,
} from "@/lib/waia-core/payment-addresses/payment-address-projection-repository.types";
export type {
  ListPaymentAddressesQuery,
  PaymentAddressProjectionRepository,
} from "@/lib/waia-core/payment-addresses/payment-address-projection-repository.types";

export type {
  CreatePaymentWalletInput,
  PaymentWalletRepository,
} from "@/lib/waia-core/payment-addresses/payment-wallet-repository.types";

export { foldPaymentAddressEventsToProjection } from "@/lib/waia-core/payment-addresses/rebuild-payment-address-projection";

export {
  createPostgresPaymentAddressEventsRepository,
  createPostgresPaymentAddressProjectionRepository,
  createPostgresPaymentWalletRepository,
  createSqlitePaymentAddressEventsRepository,
  createSqlitePaymentAddressProjectionRepository,
  createSqlitePaymentWalletRepository,
} from "@/lib/waia-core/payment-addresses/payment-address-repository-adapters";

export {
  createPaymentAddressService,
  createPostgresPaymentAddressService,
  createSqlitePaymentAddressService,
} from "@/lib/waia-core/payment-addresses/payment-address-service";
export type {
  AddressTransitionInput,
  AssignAddressInput,
  GenerateAddressInput,
  PaymentAddressService,
  PaymentAddressServiceDeps,
} from "@/lib/waia-core/payment-addresses/payment-address-service";
