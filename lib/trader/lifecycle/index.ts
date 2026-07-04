export {
  TRADE_LIFECYCLE_SEMANTICS_VERSION,
  TRADE_LIFECYCLE_SEMANTICS_VERSION_V1,
  TRADE_LIFECYCLE_SEMANTICS_VERSION_V2,
} from "@/lib/trader/lifecycle/trade-lifecycle-semantics";

export type {
  InstrumentKind,
  LifecycleEntityType,
  LifecycleEventPhase,
  LifecycleEventRow,
  PairingKey,
  PositionLotRow,
  PositionLotState,
  PositionSide,
  TradeClosingWorldState,
  TradeLegKind,
  TradeLegRow,
  TradeLineageAtOpen,
  TradeRow,
  TradeState,
} from "@/lib/trader/lifecycle/trade-lifecycle.types";

export {
  buildPairingKey,
  isTerminalTradeState,
  lifecycleEntityTypeValues,
  lifecycleEventPhaseValues,
  instrumentKindValues,
  positionLotStateValues,
  positionSideValues,
  tradeLegKindValues,
  tradeStateValues,
} from "@/lib/trader/lifecycle/trade-lifecycle.types";

export {
  applyForcedFlatSynthetic,
  countOpenLotsForKey,
  pairFillsFifo,
  type ForcedFlatSyntheticInput,
  type PairingFillEvent,
  type PairingSnapshot,
} from "@/lib/trader/lifecycle/trade-pairing";

export {
  buildPairingEvents,
  deriveTradesFromFills,
  type DeriveTradesFromFillsInput,
} from "@/lib/trader/lifecycle/derive-trades-from-fills";

export {
  TradeFrozenError,
  assertTradeLineageImmutable,
  type InsertLifecycleEventInput,
  type InsertPositionLotInput,
  type InsertTradeInput,
  type InsertTradeLegInput,
  type LifecycleRepository,
  type UpdatePositionLotInput,
  type UpdateTradeOperationalInput,
} from "@/lib/trader/lifecycle/lifecycle-repository.types";

export { createSqliteLifecycleRepository } from "@/lib/trader/lifecycle/lifecycle-repository-sqlite";

export {
  createPostgresLifecycleRepository,
  createPostgresLifecycleRepositoryFromExecutor,
} from "@/lib/trader/lifecycle/lifecycle-repository-postgres";

export {
  assertLifecycleFillWalkTaxonomyParity,
  LifecycleFillWalkParityError,
} from "@/lib/trader/lifecycle/lifecycle-fill-walk-parity";

export {
  createLifecycleRecorder,
  recordFillLifecycle,
  recordForcedFlatLifecycle,
  recordGuardianEvaluated,
  recordGuardianExitIntent,
  recordSignalAcceptedLifecycleEvent,
  type LifecycleRecorder,
  type LifecycleRecorderDeps,
  type RecordFillLifecycleInput,
  type RecordForcedFlatLifecycleInput,
  type RecordGuardianEvaluatedInput,
  type RecordGuardianExitIntentInput,
  type RecordSignalAcceptedInput,
} from "@/lib/trader/lifecycle/lifecycle-recorder";
