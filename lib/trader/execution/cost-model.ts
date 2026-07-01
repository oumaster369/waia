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

export function createCostModelV1(feesBps: string, slippageBps: string): CostModelV1 {
  return {
    version: COST_MODEL_VERSION_V1,
    feesBps,
    slippageBps,
  };
}

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
