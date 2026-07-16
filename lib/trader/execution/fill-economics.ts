import {
  EXECUTION_FACT_KIND_HISTORICAL_SIMULATED,
  HISTORICAL_EXECUTION_MODEL_ID,
  HISTORICAL_EXECUTION_MODEL_SCHEMA_VERSION,
  type CostedFillEconomics,
  type HistoricalExecutionModelV1,
  type SimulatedFillEvent,
} from "@/lib/trader/execution/historical-execution-model.types";
import type { RecordFillInput } from "@/lib/trader/execution/order-repository.types";
import {
  DECIMAL_SCALE_FACTOR,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
} from "@/lib/trader/risk/numeric";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import { sha256Hex } from "@/lib/trader/execution/deterministic-execution-id";

export class FillEconomicsInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FillEconomicsInvariantError";
  }
}

const SIMULATOR_ID = "htr-historical-simulated-exchange" as const;
const SIMULATOR_VERSION = "1.0.0" as const;

function roundHalfUpScaled(scaled: bigint): bigint {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const half = DECIMAL_SCALE_FACTOR / 2n;
  const rounded = (abs + half) / DECIMAL_SCALE_FACTOR;
  const result = rounded * DECIMAL_SCALE_FACTOR;
  return negative ? -result : result;
}

/**
 * monetaryAmount = notional × bps / 10000 at scale-8 with HALF_UP.
 * Both operands are scale-8 scaled integers; their product is scale-16.
 * One reduction divides by 10000 × DECIMAL_SCALE_FACTOR.
 */
function multiplyBpsRoundHalfUp(notional: string, bps: string): string {
  const scaledNotional = parseDecimal(notional);
  const scaledBps = parseDecimal(bps);
  const product = scaledNotional * scaledBps;
  const divisor = 10000n * DECIMAL_SCALE_FACTOR;
  const half = divisor / 2n;
  const quotient = (product + half) / divisor;
  return formatDecimal(quotient);
}

function divideRoundHalfUp(numerator: string, denominator: string): string {
  const num = parseDecimal(numerator);
  const den = parseDecimal(denominator);
  if (den === 0n) {
    throw new FillEconomicsInvariantError("[trader] divide by zero in economics");
  }
  const scaled = (num * DECIMAL_SCALE_FACTOR * 2n) / den;
  const rounded = roundHalfUpScaled(scaled);
  return formatDecimal(rounded / 2n);
}

export function computeEconomicsContentDigest(
  economics: Omit<CostedFillEconomics, "economicsContentDigest">,
): string {
  const payload = {
    executionFactKind: economics.executionFactKind,
    grossFillPrice: economics.grossFillPrice,
    grossNotional: economics.grossNotional,
    feeAmount: economics.feeAmount,
    feeAsset: economics.feeAsset,
    spreadCost: economics.spreadCost,
    impactSlippageCost: economics.impactSlippageCost,
    totalExecutionCost: economics.totalExecutionCost,
    netFillPrice: economics.netFillPrice,
    netCashEffect: economics.netCashEffect,
    executionModelId: economics.executionModelId,
    executionModelSchemaVersion: economics.executionModelSchemaVersion,
    simulatorId: economics.simulatorId,
    simulatorVersion: economics.simulatorVersion,
    sourceBarIndex: economics.sourceBarIndex,
    fillSequence: economics.fillSequence,
    symbol: economics.symbol,
    side: economics.side,
    quantity: economics.quantity,
    remainingQuantityAfter: economics.remainingQuantityAfter,
    submitLatencyMs: economics.submitLatencyMs,
    cancelLatencyMs: economics.cancelLatencyMs,
  };
  return sha256Hex(canonicalJsonString(payload));
}

/**
 * Authoritative single application point for historical execution economics (D-5).
 * Component order: grossNotional → fee → spread → impact → total → netPrice → netCash → digest.
 */
export function applyHistoricalExecutionEconomics(
  event: SimulatedFillEvent,
  model: HistoricalExecutionModelV1,
): CostedFillEconomics {
  const grossNotional = multiplyDecimal(event.grossFillPrice, event.sliceQuantity);
  const feeAmount = multiplyBpsRoundHalfUp(grossNotional, model.takerFeeBps);
  const spreadCost = multiplyBpsRoundHalfUp(grossNotional, model.halfSpreadBpsPerSide);
  const impactSlippageCost = multiplyBpsRoundHalfUp(grossNotional, model.impactValueBps);
  const totalExecutionCost = formatDecimal(
    parseDecimal(feeAmount) + parseDecimal(spreadCost) + parseDecimal(impactSlippageCost),
  );

  const spreadHalf = divideRoundHalfUp(
    multiplyDecimal(event.grossFillPrice, model.halfSpreadBpsPerSide),
    "10000",
  );
  const impactHalf = divideRoundHalfUp(
    multiplyDecimal(event.grossFillPrice, model.impactValueBps),
    "10000",
  );

  const grossScaled = parseDecimal(event.grossFillPrice);
  const spreadScaled = parseDecimal(spreadHalf);
  const impactScaled = parseDecimal(impactHalf);

  const netPriceScaled =
    event.side === "buy"
      ? grossScaled + spreadScaled + impactScaled
      : grossScaled - spreadScaled - impactScaled;
  const netFillPrice = formatDecimal(netPriceScaled);

  const principalScaled = parseDecimal(multiplyDecimal(netFillPrice, event.sliceQuantity));
  const feeScaled = parseDecimal(feeAmount);
  const netCashScaled =
    event.side === "buy" ? -(principalScaled + feeScaled) : principalScaled - feeScaled;
  const netCashEffect = formatDecimal(netCashScaled);

  const base: Omit<CostedFillEconomics, "economicsContentDigest"> = {
    executionFactKind: EXECUTION_FACT_KIND_HISTORICAL_SIMULATED,
    grossFillPrice: event.grossFillPrice,
    grossNotional,
    feeAmount,
    feeAsset: "USDT",
    spreadCost,
    impactSlippageCost,
    totalExecutionCost,
    netFillPrice,
    netCashEffect,
    executionModelId: HISTORICAL_EXECUTION_MODEL_ID,
    executionModelSchemaVersion: HISTORICAL_EXECUTION_MODEL_SCHEMA_VERSION,
    simulatorId: SIMULATOR_ID,
    simulatorVersion: SIMULATOR_VERSION,
    sourceBarTimestamp: new Date(event.sourceBar.barCloseTime),
    sourceBarIndex: event.sourceBarIndex,
    acceptedAt: event.acceptedAt,
    fillTimestamp: event.fillTimestamp,
    submitLatencyMs: event.submitLatencyMs,
    cancelLatencyMs: event.cancelLatencyMs,
    remainingQuantityAfter: event.remainingQuantityAfter,
    fillSequence: event.fillSequence,
    symbol: event.symbol,
    side: event.side,
    quantity: event.sliceQuantity,
  };

  const economicsContentDigest = computeEconomicsContentDigest(base);
  return { ...base, economicsContentDigest };
}

function requireNonEmptyString(value: string | undefined | null, field: string): string {
  if (value === undefined || value === null || value.trim() === "") {
    throw new FillEconomicsInvariantError(`[trader] missing economics field: ${field}`);
  }
  return value;
}

export function assertCompleteHistoricalFillEconomics(
  input: RecordFillInput,
): asserts input is RecordFillInput & {
  executionFactKind: typeof EXECUTION_FACT_KIND_HISTORICAL_SIMULATED;
  economics: CostedFillEconomics;
} {
  if (input.executionFactKind !== EXECUTION_FACT_KIND_HISTORICAL_SIMULATED) {
    throw new FillEconomicsInvariantError(
      `[trader] expected executionFactKind ${EXECUTION_FACT_KIND_HISTORICAL_SIMULATED}`,
    );
  }
  const economics = input.economics;
  if (!economics) {
    throw new FillEconomicsInvariantError("[trader] missing economics payload");
  }
  if (economics.executionModelSchemaVersion !== HISTORICAL_EXECUTION_MODEL_SCHEMA_VERSION) {
    throw new FillEconomicsInvariantError("[trader] unknown execution model schema version");
  }
  requireNonEmptyString(economics.grossFillPrice, "grossFillPrice");
  requireNonEmptyString(economics.grossNotional, "grossNotional");
  requireNonEmptyString(economics.feeAmount, "feeAmount");
  requireNonEmptyString(economics.spreadCost, "spreadCost");
  requireNonEmptyString(economics.impactSlippageCost, "impactSlippageCost");
  requireNonEmptyString(economics.totalExecutionCost, "totalExecutionCost");
  requireNonEmptyString(economics.netFillPrice, "netFillPrice");
  requireNonEmptyString(economics.netCashEffect, "netCashEffect");
  requireNonEmptyString(economics.economicsContentDigest, "economicsContentDigest");
  if (!/^[0-9a-f]{64}$/.test(economics.economicsContentDigest)) {
    throw new FillEconomicsInvariantError("[trader] invalid economics_content_digest");
  }
  const recomputed = computeEconomicsContentDigest(economics);
  if (recomputed !== economics.economicsContentDigest) {
    throw new FillEconomicsInvariantError("[trader] economics_content_digest mismatch");
  }
}

export const HISTORICAL_FILL_ECONOMICS_EXPORT_SCHEMA_VERSION =
  "waia.trader.historical-fill-economics-export.v1" as const;

export type SerializedHistoricalFillEconomicsExport = {
  schemaVersion: typeof HISTORICAL_FILL_ECONOMICS_EXPORT_SCHEMA_VERSION;
  executionFactKind: typeof EXECUTION_FACT_KIND_HISTORICAL_SIMULATED;
  executionModelId: typeof HISTORICAL_EXECUTION_MODEL_ID;
  executionModelSchemaVersion: typeof HISTORICAL_EXECUTION_MODEL_SCHEMA_VERSION;
  grossFillPrice: string;
  grossNotional: string;
  feeAmount: string;
  spreadCost: string;
  impactSlippageCost: string;
  totalExecutionCost: string;
  netFillPrice: string;
  netCashEffect: string;
  economicsContentDigest: string;
  fillSequence: number;
};

export function serializeHistoricalFillEconomicsForExport(economics: CostedFillEconomics): string {
  const body: SerializedHistoricalFillEconomicsExport = {
    schemaVersion: HISTORICAL_FILL_ECONOMICS_EXPORT_SCHEMA_VERSION,
    executionFactKind: EXECUTION_FACT_KIND_HISTORICAL_SIMULATED,
    executionModelId: economics.executionModelId,
    executionModelSchemaVersion: economics.executionModelSchemaVersion,
    grossFillPrice: economics.grossFillPrice,
    grossNotional: economics.grossNotional,
    feeAmount: economics.feeAmount,
    spreadCost: economics.spreadCost,
    impactSlippageCost: economics.impactSlippageCost,
    totalExecutionCost: economics.totalExecutionCost,
    netFillPrice: economics.netFillPrice,
    netCashEffect: economics.netCashEffect,
    economicsContentDigest: economics.economicsContentDigest,
    fillSequence: economics.fillSequence,
  };
  return JSON.stringify(body);
}

export function parseHistoricalFillEconomicsExportPayload(
  payload: string | null,
): SerializedHistoricalFillEconomicsExport | null {
  if (!payload) {
    return null;
  }
  try {
    const parsed = JSON.parse(payload) as SerializedHistoricalFillEconomicsExport;
    if (parsed.schemaVersion !== HISTORICAL_FILL_ECONOMICS_EXPORT_SCHEMA_VERSION) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function computeHistoricalExecutionAggregateDigest(digests: readonly string[]): string {
  const sorted = [...digests].sort((a, b) => a.localeCompare(b));
  return sha256Hex(canonicalJsonString(sorted));
}
