import {
  addDecimal,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

export const COST_MODEL_VERSION_V1 = "waia.trader.cost-model.v1" as const;

export type CostModelVersionV1 = typeof COST_MODEL_VERSION_V1;

export type CostModelV1 = {
  version: CostModelVersionV1;
  feesBps: string;
  slippageBps: string;
};

export type CostAdjustedFill = {
  adjustedPrice: string;
  fee: string;
};

export type CostModelFillSide = "buy" | "sell";

/**
 * @deprecated Non-production historical fixture constructor only.
 * Production executable paths MUST use
 * `costModelV1FromAuthority(createHtrHistoricalCostModelAuthorityV1())`.
 */
export function createCostModelV1(feesBps: string, slippageBps: string): CostModelV1 {
  return {
    version: COST_MODEL_VERSION_V1,
    feesBps,
    slippageBps,
  };
}

export {
  assertHtrHistoricalCostModelMatch,
  computeHtrHistoricalCostModelDigest,
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
  HTR_HISTORICAL_COST_MODEL_DIGEST,
  HTR_HISTORICAL_COST_MODEL_FEE_BPS,
  HTR_HISTORICAL_COST_MODEL_HALF_SPREAD_BPS,
  HTR_HISTORICAL_COST_MODEL_ID,
  HTR_HISTORICAL_COST_MODEL_MARKET_IMPACT_BPS,
  HTR_HISTORICAL_COST_MODEL_SCHEMA_VERSION,
  HTR_HISTORICAL_COST_MODEL_SLIPPAGE_MODEL,
  type HtrHistoricalCostModelAuthorityV1,
} from "@/lib/trader/execution/htr-historical-cost-model-authority";

/**
 * Applies versioned slippage (worse fill price) and fee drag (bps of notional).
 *
 * Buy fills pay a higher price; sell fills receive a lower price. Fee is charged
 * on adjusted notional in quote currency.
 */
export function applyCostToFill(
  price: string,
  quantity: string,
  side: CostModelFillSide,
  costModel: Pick<CostModelV1, "feesBps" | "slippageBps">,
): CostAdjustedFill {
  const slippageFactor = divideDecimal(costModel.slippageBps, "10000");
  const slippageMultiplier =
    side === "buy" ? addDecimal("1", slippageFactor) : subtractDecimal("1", slippageFactor);

  const adjustedPrice = multiplyDecimal(price, slippageMultiplier);
  const notional = multiplyDecimal(adjustedPrice, quantity);
  const fee = multiplyDecimal(notional, divideDecimal(costModel.feesBps, "10000"));

  return {
    adjustedPrice,
    fee,
  };
}
