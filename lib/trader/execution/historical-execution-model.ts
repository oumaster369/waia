import {
  HISTORICAL_EXECUTION_MODEL_ID,
  HISTORICAL_EXECUTION_MODEL_SCHEMA_VERSION,
  EXECUTION_FACT_KIND_HISTORICAL_SIMULATED,
  type HistoricalExecutionModelV1,
} from "@/lib/trader/execution/historical-execution-model.types";

export class InvalidHistoricalExecutionModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidHistoricalExecutionModelError";
  }
}

/** Human-approved D-5 model (HTR-WP17). */
export function createHistoricalExecutionModelV1(): HistoricalExecutionModelV1 {
  return {
    modelId: HISTORICAL_EXECUTION_MODEL_ID,
    schemaVersion: HISTORICAL_EXECUTION_MODEL_SCHEMA_VERSION,
    supportedOrderTypes: ["MARKET"],
    liquidityRole: "TAKER",
    historicalOrderSemantic: "PARTICIPATION_SLICED_MARKET_PARENT_ORDER",
    venue: "HTX",
    market: "SPOT",
    symbols: ["BTCUSDT", "ETHUSDT"],
    takerFeeBps: "20",
    makerFeeBps: "20",
    feeAssetPolicy: "QUOTE_ASSET_USDT",
    halfSpreadBpsPerSide: "5",
    impactValueBps: "10",
    submitLatencyMs: 50,
    cancelLatencyMs: 100,
    participationCapFraction: "0.10",
    minimumExecutableSliceQty: "0.00000001",
    quantityStep: "0.00000001",
    timeInForceSemantic: "GOOD_FOR_N_ELIGIBLE_CLOSED_BARS",
    maxEligibleClosedBars: 3,
    expiryPolicy: "EXPIRE_REMAINDER_AFTER_MAX_ELIGIBLE_CLOSED_BARS",
    priceReference: "ELIGIBLE_CLOSED_BAR_CLOSE",
    firstEligibleBar: "N+1",
    volumeField: "bar.volume",
    volumeSemantics: "ASSUMED_BASE_ASSET_UNVERIFIED",
    executionFactKind: EXECUTION_FACT_KIND_HISTORICAL_SIMULATED,
    deterministicIdScheme: "CONTENT_ADDRESSED_SHA256_UUIDV8",
    decimalScale: 8,
    rounding: "ROUND_HALF_UP",
    unsupportedOrderBehavior: "REJECT_FAIL_CLOSED",
  };
}

export function assertModelMatchesD5(model: HistoricalExecutionModelV1): void {
  const expected = createHistoricalExecutionModelV1();
  if (JSON.stringify(model) !== JSON.stringify(expected)) {
    throw new InvalidHistoricalExecutionModelError(
      "[trader] historical execution model does not match approved D-5",
    );
  }
}
