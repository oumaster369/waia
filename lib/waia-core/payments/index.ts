export {
  PAYMENT_EVENT_SCHEMA_VERSION,
  paymentDirections,
  paymentEventTypes,
  paymentFailureReasons,
  paymentSubjectModules,
} from "@/lib/waia-core/payments/payment-events.types";
export type {
  PaymentDirection,
  PaymentEventDigestInput,
  PaymentEventRecordPayload,
  PaymentEventRecordView,
  PaymentEventType,
  PaymentFailureReason,
  PaymentSubjectModule,
  SettlementEvidence,
} from "@/lib/waia-core/payments/payment-events.types";

export { paymentStatuses } from "@/lib/waia-core/payments/payment-projection.types";
export type {
  PaymentProjectionView,
  PaymentStatus,
} from "@/lib/waia-core/payments/payment-projection.types";

export {
  IllegalPaymentTransitionError,
  PaymentAddressNotAttributableError,
  PaymentAttributionRequiredError,
  PaymentChainBrokenError,
  PaymentConcurrentConflictError,
  PaymentDigestMismatchError,
  PaymentIdempotencyConflictError,
  PaymentNotFoundError,
  PaymentSettlementAlreadyAttributedError,
} from "@/lib/waia-core/payments/payment.errors";

export {
  assertPaymentTransitionAllowed,
  eventTypeToStatus,
  isTerminalPaymentStatus,
} from "@/lib/waia-core/payments/payment-lifecycle.transitions";

export {
  buildPaymentEventRecordPayload,
  computePaymentEventDigest,
  serializePaymentEventDigestInput,
  verifyPaymentEventChain,
  verifyPaymentEventDigest,
} from "@/lib/waia-core/payments/serialize-payment-events";

export { foldPaymentEventsToProjection } from "@/lib/waia-core/payments/rebuild-payment-projection";

export {
  createPostgresPaymentEventsRepository,
  createPostgresPaymentsProjectionRepository,
  createSqlitePaymentEventsRepository,
  createSqlitePaymentsProjectionRepository,
} from "@/lib/waia-core/payments/payment-repository-adapters";

export {
  createPaymentService,
  createPostgresPaymentService,
  createSqlitePaymentService,
} from "@/lib/waia-core/payments/payment-service";
export type {
  ConfirmPaymentInput,
  DetectPaymentInput,
  FailPaymentInput,
  PaymentService,
  PaymentServiceDeps,
} from "@/lib/waia-core/payments/payment-service";

export {
  createPostgresPaymentAddressAttributionReader,
  createSqlitePaymentAddressAttributionReader,
} from "@/lib/waia-core/payments/payment-address-attribution.port";
export type { PaymentAddressAttributionReader } from "@/lib/waia-core/payments/payment-address-attribution.port";

export { paymentAuditActions, paymentEntityTypes } from "@/lib/waia-core/types";
