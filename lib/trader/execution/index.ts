export { mapConnectorStatusToOrderState } from "@/lib/trader/execution/connector-status-map";
export {
  assertTransition,
  isLegalTransition,
  isTerminal,
  ORDER_TRANSITIONS,
  TERMINAL_ORDER_STATES,
} from "@/lib/trader/execution/order-state-machine";
export {
  DuplicateOrderError,
  FillConflictError,
  OrderNotFoundError,
  OrderVersionConflictError,
} from "@/lib/trader/execution/order-repository.errors";
export {
  fillPayloadMatches,
  orderPayloadMatches,
  type CreateOrderInput,
  type FillRow,
  type OpenOrdersFilter,
  type OrderEventRow,
  type OrderRepository,
  type OrderRow,
  type RecordFillInput,
  type TransitionOrderInput,
} from "@/lib/trader/execution/order-repository.types";
export {
  createPostgresOrderRepository,
  createPostgresOrderRepositoryFromExecutor,
  createSqliteOrderRepository,
} from "@/lib/trader/execution/repository-adapters";
export {
  createOrderExecutionServiceFromDeps,
  createPostgresOrderExecutionService,
  createPostgresOrderExecutionServiceFromExecutor,
  createSqliteOrderExecutionService,
  canDispatch,
  createDefaultConnectorForMode,
} from "@/lib/trader/execution/execution-service";
export {
  LiveExecutionNotSupportedError,
  UnsupportedExecutionModeError,
} from "@/lib/trader/execution/execution-service.errors";
export type {
  OrderExecutionService,
  OrderExecutionServiceDeps,
  SubmissionAuditIds,
  SubmitOrderInput,
  SubmitOrderResult,
} from "@/lib/trader/execution/execution-service.types";
export {
  classifyReconciliation,
  classifyReconciliationForOrder,
  deriveTerminalDriftEscalationKind,
  type ConnectorView,
} from "@/lib/trader/execution/reconciliation-classification";
export {
  mapOutcomeToTriggerSignals,
  dedupeTriggerSignals,
  processReconciliationEscalation,
} from "@/lib/trader/execution/reconciliation-escalation";
export type {
  EscalationActivationOutcome,
  ReconciliationEscalationReport,
} from "@/lib/trader/execution/reconciliation-escalation.types";
export {
  createReconciliationServiceFromDeps,
  createPostgresReconciliationService,
  createPostgresReconciliationServiceFromExecutor,
  createSqliteReconciliationService,
} from "@/lib/trader/execution/reconciliation-service";
export {
  createPostgresStartupReconciliationRunner,
  createPostgresStartupReconciliationRunnerFromExecutor,
  createSqliteStartupReconciliationRunner,
  createStartupReconciliationRunnerFromDeps,
  runStartupReconciliation,
} from "@/lib/trader/execution/reconciliation-startup";
export type {
  StartupReconciliationDeps,
  StartupReconciliationResult,
  StartupReconciliationRunner,
  StartupExecutionMode,
} from "@/lib/trader/execution/reconciliation-startup.types";
export {
  POST_DISPATCH_RECONCILABLE_STATES,
  emptyReconciliationCounts,
  isPostDispatchReconcilable,
  isPreDispatchState,
  reconciliationClassificationEnum,
  type OrderReconciliationOutcome,
  type ReconciliationClassification,
  type ReconciliationEscalationKind,
  type ReconciliationReport,
  type ReconciliationService,
  type ReconciliationServiceDeps,
  type ReconcileTarget,
} from "@/lib/trader/execution/reconciliation.types";
export {
  IllegalOrderTransitionError,
  orderEventTypeEnum,
  orderExecutionModeEnum,
  orderStateEnum,
  type OrderEventType,
  type OrderExecutionMode,
  type OrderSide,
  type OrderState,
  type OrderType,
} from "@/lib/trader/execution/types";
