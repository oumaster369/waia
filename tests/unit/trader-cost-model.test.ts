import { describe, expect, it } from "vitest";

import {
  applyCostToFill,
  COST_MODEL_VERSION_V1,
  createCostModelV1,
} from "@/lib/trader/execution/cost-model";

describe("cost model v1 (RI-P2 / Batch C)", () => {
  const costModel = createCostModelV1("10", "25");

  it("creates a versioned v1 cost model", () => {
    expect(costModel.version).toBe(COST_MODEL_VERSION_V1);
    expect(costModel.feesBps).toBe("10");
    expect(costModel.slippageBps).toBe("25");
  });

  it("worsens buy fills with slippage and charges fee on adjusted notional", () => {
    const result = applyCostToFill("100", "1", "buy", costModel);

    expect(result.adjustedPrice).toBe("100.25");
    expect(result.fee).toBe("0.10025");
  });

  it("worsens sell fills with slippage and charges fee on adjusted notional", () => {
    const result = applyCostToFill("100", "1", "sell", costModel);

    expect(result.adjustedPrice).toBe("99.75");
    expect(result.fee).toBe("0.09975");
  });

  it("returns zero fee when feesBps is zero", () => {
    const zeroFees = createCostModelV1("0", "25");
    const result = applyCostToFill("64000", "0.01", "buy", zeroFees);

    expect(result.fee).toBe("0");
    expect(result.adjustedPrice).toBe("64160");
  });

  it("leaves price unchanged when slippageBps is zero", () => {
    const zeroSlippage = createCostModelV1("10", "0");
    const result = applyCostToFill("64000", "0.01", "sell", zeroSlippage);

    expect(result.adjustedPrice).toBe("64000");
    expect(result.fee).toBe("0.64");
  });
});
