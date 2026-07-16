import type { OrderSide } from "@/lib/trader/execution/types";
import type { Bar } from "@/lib/trader/intelligence/types";

export const HISTORICAL_EXECUTION_MODEL_ID = "htr-historical-execution-v1" as const;
export const HISTORICAL_EXECUTION_MODEL_SCHEMA_VERSION =
  "waia.trader.historical-execution-model.v1" as const;

export const EXECUTION_FACT_KIND_VENUE_FILL = "VENUE_FILL" as const;
export const EXECUTION_FACT_KIND_HISTORICAL_SIMULATED = "HISTORICAL_SIMULATED_FILL_V1" as const;

export type ExecutionFactKind =
  | typeof EXECUTION_FACT_KIND_VENUE_FILL
  | typeof EXECUTION_FACT_KIND_HISTORICAL_SIMULATED;

export type HistoricalExecutionModelV1 = {
  modelId: typeof HISTORICAL_EXECUTION_MODEL_ID;
  schemaVersion: typeof HISTORICAL_EXECUTION_MODEL_SCHEMA_VERSION;
  supportedOrderTypes: readonly ["MARKET"];
  liquidityRole: "TAKER";
  historicalOrderSemantic: "PARTICIPATION_SLICED_MARKET_PARENT_ORDER";
  venue: "HTX";
  market: "SPOT";
  symbols: readonly ["BTCUSDT", "ETHUSDT"];
  takerFeeBps: string;
  makerFeeBps: string;
  feeAssetPolicy: "QUOTE_ASSET_USDT";
  halfSpreadBpsPerSide: string;
  impactValueBps: string;
  submitLatencyMs: number;
  cancelLatencyMs: number;
  participationCapFraction: string;
  minimumExecutableSliceQty: string;
  quantityStep: string;
  timeInForceSemantic: "GOOD_FOR_N_ELIGIBLE_CLOSED_BARS";
  maxEligibleClosedBars: number;
  expiryPolicy: "EXPIRE_REMAINDER_AFTER_MAX_ELIGIBLE_CLOSED_BARS";
  priceReference: "ELIGIBLE_CLOSED_BAR_CLOSE";
  firstEligibleBar: "N+1";
  volumeField: "bar.volume";
  volumeSemantics: "ASSUMED_BASE_ASSET_UNVERIFIED";
  executionFactKind: typeof EXECUTION_FACT_KIND_HISTORICAL_SIMULATED;
  deterministicIdScheme: "CONTENT_ADDRESSED_SHA256_UUIDV8";
  decimalScale: 8;
  rounding: "ROUND_HALF_UP";
  unsupportedOrderBehavior: "REJECT_FAIL_CLOSED";
};

export type SimulatedFillEvent = {
  orderId: string;
  organizationId: string;
  symbol: string;
  side: OrderSide;
  fillSequence: number;
  sourceBarIndex: number;
  sourceBar: Bar;
  grossFillPrice: string;
  sliceQuantity: string;
  remainingQuantityAfter: string;
  acceptedAt: Date;
  fillTimestamp: Date;
  submitLatencyMs: number;
  cancelLatencyMs: number | null;
};

export type CostedFillEconomics = {
  executionFactKind: typeof EXECUTION_FACT_KIND_HISTORICAL_SIMULATED;
  grossFillPrice: string;
  grossNotional: string;
  feeAmount: string;
  feeAsset: string;
  spreadCost: string;
  impactSlippageCost: string;
  totalExecutionCost: string;
  netFillPrice: string;
  netCashEffect: string;
  economicsContentDigest: string;
  executionModelId: typeof HISTORICAL_EXECUTION_MODEL_ID;
  executionModelSchemaVersion: typeof HISTORICAL_EXECUTION_MODEL_SCHEMA_VERSION;
  simulatorId: string;
  simulatorVersion: string;
  sourceBarTimestamp: Date;
  sourceBarIndex: number;
  acceptedAt: Date;
  fillTimestamp: Date;
  submitLatencyMs: number;
  cancelLatencyMs: number | null;
  remainingQuantityAfter: string;
  fillSequence: number;
  symbol: string;
  side: OrderSide;
  quantity: string;
};

export type FillExecutionEconomicsRow = {
  id: string;
  organizationId: string;
  fillId: string;
  orderId: string;
  exchangeTradeId: string;
  fillSequence: number;
  symbol: string;
  side: OrderSide;
  quantity: string;
  grossFillPrice: string;
  grossNotional: string;
  feeAmount: string;
  feeAsset: string;
  spreadCost: string;
  impactSlippageCost: string;
  totalExecutionCost: string;
  netFillPrice: string;
  netCashEffect: string;
  remainingQuantityAfter: string;
  executionModelId: string;
  executionModelSchemaVersion: string;
  simulatorId: string;
  simulatorVersion: string;
  sourceBarTimestamp: Date;
  sourceBarIndex: number;
  acceptedAt: Date;
  fillTimestamp: Date;
  submitLatencyMs: number;
  cancelLatencyMs: number | null;
  executionFactKind: typeof EXECUTION_FACT_KIND_HISTORICAL_SIMULATED;
  economicsContentDigest: string;
  schemaVersion: string;
};

export type HistoricalExecutionCheckpointSlice = {
  schemaVersion: "htr-wp17-execution-checkpoint/v1";
  openOrders: ReadonlyArray<{
    orderId: string;
    acceptedAtTs: number;
    firstEligibleTs: number;
    windowEndBarIndex: number;
    remainingQty: string;
    filledQty: string;
    fillSequence: number;
    pendingCancel?: {
      requestedAtTs: number;
      cancelEffectiveTs: number;
    };
  }>;
  executionModelSchemaVersion: typeof HISTORICAL_EXECUTION_MODEL_SCHEMA_VERSION;
};

export type HistoricalExecutionEventClass = "CANCEL_EFFECTIVE" | "FILL" | "EXPIRY";
