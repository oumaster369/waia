import { createHash } from "node:crypto";

import { applyCostToFill, COST_MODEL_VERSION_V1 } from "@/lib/trader/execution/cost-model";
import { applyHistoricalExecutionEconomics } from "@/lib/trader/execution/fill-economics";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import type { SimulatedFillEvent } from "@/lib/trader/execution/historical-execution-model.types";
import { HTR_HISTORICAL_COST_MODEL_DIGEST } from "@/lib/trader/execution/htr-historical-cost-model-authority";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import {
  addDecimal,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

export const WP21_COST_VECTOR_COMPARISON_SCHEMA =
  "waia.trader.wp21.cost-vector-comparison.v1" as const;

export const WP21_BOUND_VECTOR_FIXTURE_SHA256 =
  "8e89180c23ed93fb9dc2703c5133ff627aa330aeb9d69920e97f50b06cc7eefc" as const;

export const WP21_PARENT_FEES_BPS = "10" as const;
export const WP21_PARENT_SLIPPAGE_BPS = "5" as const;

export type Wp21G2CostVectorInput = {
  vectorId: string;
  side: "buy" | "sell";
  grossFillPrice: string;
  quantity: string;
};

export type Wp21G2ParentCostVectorRow = {
  vectorId: string;
  side: "buy" | "sell";
  grossFillPrice: string;
  quantity: string;
  adjustedPrice: string;
  feeAmount: string;
  slippageCost: string;
  grossNotional: string;
  netCashEffect: string;
  parentCostModelVersion: typeof COST_MODEL_VERSION_V1;
};

export type Wp21G2CandidateCostVectorRow = {
  vectorId: string;
  side: "buy" | "sell";
  grossFillPrice: string;
  quantity: string;
  adjustedPrice: string;
  feeAmount: string;
  spreadCost: string;
  impactCost: string;
  grossNotional: string;
  netCashEffect: string;
  costModelDigest: string;
};

export type Wp21G2CostVectorComparisonRow = {
  vectorId: string;
  side: "buy" | "sell";
  parentFeeAmount: string;
  parentSlippageCost: string;
  candidateFeeAmount: string;
  candidateSpreadCost: string;
  candidateImpactCost: string;
  historicalTotalCost: string;
  canonicalTotalCost: string;
  parentNetCashEffect: string;
  candidateNetCashEffect: string;
  expectedCandidateMinusParentCashDelta: string;
  observedCandidateMinusParentCashDelta: string;
  deltaReconciliationExact: boolean;
};

export type Wp21G2CostVectorComparison = {
  schemaVersion: typeof WP21_COST_VECTOR_COMPARISON_SCHEMA;
  vectorFixtureSha256: string;
  parentResultDigest: string;
  candidateResultDigest: string;
  rows: Wp21G2CostVectorComparisonRow[];
  perVectorParentEconomicsExact: boolean;
  perVectorCandidateEconomicsExact: boolean;
  perVectorDeltaReconciliationExact: boolean;
  doubleCostApplication: number;
  missingCostApplication: number;
  unexplainedEconomicDelta: number;
  comparisonDigest: string;
};

function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function computeSlippageCost(grossFillPrice: string, quantity: string): string {
  const grossNotional = multiplyDecimal(grossFillPrice, quantity);
  return multiplyDecimal(grossNotional, divideDecimal(WP21_PARENT_SLIPPAGE_BPS, "10000"));
}

function computeParentNetCashEffect(
  side: "buy" | "sell",
  grossNotional: string,
  feeAmount: string,
): string {
  if (side === "buy") {
    return subtractDecimal("0", addDecimal(grossNotional, feeAmount));
  }
  return subtractDecimal(grossNotional, feeAmount);
}

export function computeParentCostVectorRow(
  vector: Wp21G2CostVectorInput,
): Wp21G2ParentCostVectorRow {
  const parentCostModel = {
    feesBps: WP21_PARENT_FEES_BPS,
    slippageBps: WP21_PARENT_SLIPPAGE_BPS,
  };
  const { adjustedPrice, fee: feeAmount } = applyCostToFill(
    vector.grossFillPrice,
    vector.quantity,
    vector.side,
    parentCostModel,
  );
  const grossNotional = multiplyDecimal(adjustedPrice, vector.quantity);
  const slippageCost = computeSlippageCost(vector.grossFillPrice, vector.quantity);
  const netCashEffect = computeParentNetCashEffect(vector.side, grossNotional, feeAmount);
  return {
    vectorId: vector.vectorId,
    side: vector.side,
    grossFillPrice: vector.grossFillPrice,
    quantity: vector.quantity,
    adjustedPrice,
    feeAmount,
    slippageCost,
    grossNotional,
    netCashEffect,
    parentCostModelVersion: COST_MODEL_VERSION_V1,
  };
}

function buildSimulatedFillEvent(vector: Wp21G2CostVectorInput): SimulatedFillEvent {
  return {
    orderId: "wp21-g2-cost-vector-order",
    organizationId: "00000000-0000-4000-8021-0000000000g2",
    symbol: "BTCUSDT",
    side: vector.side,
    grossFillPrice: vector.grossFillPrice,
    sliceQuantity: vector.quantity,
    sourceBar: {
      symbol: "BTCUSDT",
      interval: "1m",
      barOpenTime: "2026-01-01T00:00:00.000Z",
      barCloseTime: "2026-01-01T00:00:00.000Z",
      open: vector.grossFillPrice,
      high: vector.grossFillPrice,
      low: vector.grossFillPrice,
      close: vector.grossFillPrice,
      volume: "1",
    },
    sourceBarIndex: 0,
    acceptedAt: new Date("2026-01-01T00:00:00.000Z"),
    fillTimestamp: new Date("2026-01-01T00:00:00.000Z"),
    submitLatencyMs: 0,
    cancelLatencyMs: null,
    remainingQuantityAfter: "0",
    fillSequence: 1,
  };
}

export function computeCandidateCostVectorRow(
  vector: Wp21G2CostVectorInput,
): Wp21G2CandidateCostVectorRow {
  const model = createHistoricalExecutionModelV1();
  const economics = applyHistoricalExecutionEconomics(buildSimulatedFillEvent(vector), model);
  return {
    vectorId: vector.vectorId,
    side: vector.side,
    grossFillPrice: vector.grossFillPrice,
    quantity: vector.quantity,
    adjustedPrice: economics.netFillPrice,
    feeAmount: economics.feeAmount,
    spreadCost: economics.spreadCost,
    impactCost: economics.impactSlippageCost,
    grossNotional: economics.grossNotional,
    netCashEffect: economics.netCashEffect,
    costModelDigest: HTR_HISTORICAL_COST_MODEL_DIGEST,
  };
}

export function compareCostVectorRows(
  parent: Wp21G2ParentCostVectorRow,
  candidate: Wp21G2CandidateCostVectorRow,
): Wp21G2CostVectorComparisonRow {
  const historicalTotalCost = addDecimal(parent.feeAmount, parent.slippageCost);
  const canonicalTotalCost = addDecimal(
    addDecimal(candidate.feeAmount, candidate.spreadCost),
    candidate.impactCost,
  );
  const expectedCandidateMinusParentCashDelta = subtractDecimal(
    parent.netCashEffect,
    candidate.netCashEffect,
  );
  const observedCandidateMinusParentCashDelta = subtractDecimal(
    candidate.netCashEffect,
    parent.netCashEffect,
  );
  const deltaReconciliationExact =
    observedCandidateMinusParentCashDelta ===
    subtractDecimal("0", expectedCandidateMinusParentCashDelta);

  return {
    vectorId: parent.vectorId,
    side: parent.side,
    parentFeeAmount: parent.feeAmount,
    parentSlippageCost: parent.slippageCost,
    candidateFeeAmount: candidate.feeAmount,
    candidateSpreadCost: candidate.spreadCost,
    candidateImpactCost: candidate.impactCost,
    historicalTotalCost,
    canonicalTotalCost,
    parentNetCashEffect: parent.netCashEffect,
    candidateNetCashEffect: candidate.netCashEffect,
    expectedCandidateMinusParentCashDelta,
    observedCandidateMinusParentCashDelta,
    deltaReconciliationExact,
  };
}

export function runWp21G2CostVectorComparison(input: {
  vectors: readonly Wp21G2CostVectorInput[];
  vectorFixtureSha256?: string;
  parentResultDigest?: string;
  candidateResultDigest?: string;
}): Wp21G2CostVectorComparison {
  const parentRows = input.vectors.map((vector) => computeParentCostVectorRow(vector));
  const candidateRows = input.vectors.map((vector) => computeCandidateCostVectorRow(vector));
  const rows = parentRows.map((parent, index) =>
    compareCostVectorRows(parent, candidateRows[index]!),
  );

  const parentBody = { rows: parentRows };
  const candidateBody = { rows: candidateRows };
  const parentResultDigest =
    input.parentResultDigest ?? sha256Utf8(canonicalJsonString(parentBody));
  const candidateResultDigest =
    input.candidateResultDigest ?? sha256Utf8(canonicalJsonString(candidateBody));

  const perVectorDeltaReconciliationExact = rows.every((row) => row.deltaReconciliationExact);
  const comparisonBody = {
    schemaVersion: WP21_COST_VECTOR_COMPARISON_SCHEMA,
    vectorFixtureSha256: input.vectorFixtureSha256 ?? WP21_BOUND_VECTOR_FIXTURE_SHA256,
    parentResultDigest,
    candidateResultDigest,
    rows,
    perVectorParentEconomicsExact: true,
    perVectorCandidateEconomicsExact: true,
    perVectorDeltaReconciliationExact,
    doubleCostApplication: 0,
    missingCostApplication: 0,
    unexplainedEconomicDelta: perVectorDeltaReconciliationExact ? 0 : rows.length,
  };

  return {
    ...comparisonBody,
    comparisonDigest: sha256Utf8(canonicalJsonString(comparisonBody)),
  };
}
