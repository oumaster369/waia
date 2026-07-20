import { describe, expect, it } from "vitest";

import {
  applyCostToFill,
  costModelV1FromAuthority,
  createCostModelV1,
  createHtrHistoricalCostModelAuthorityV1,
} from "@/lib/trader/execution/cost-model";
import { applyHistoricalExecutionEconomics } from "@/lib/trader/execution/fill-economics";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import { computeHtrHistoricalCostModelDigest } from "@/lib/trader/execution/htr-historical-cost-model-authority";
import { HTR_FHV_RUN_CONTRACT_V0 } from "@/lib/trader/readiness/htr-fhv-run-contract-v0";
import { addDecimal, compareDecimal, multiplyDecimal } from "@/lib/trader/risk/numeric";
import { makeWp17Bar } from "@/tests/unit/helpers/wp17-execution-fixtures";

describe("trader corrective A2 PnL cost applied once", () => {
  it("applies D-5 costs once without legacy 10/5 stacking", () => {
    const bar = makeWp17Bar(1);
    const event = {
      orderId: "a2-pnl-once",
      organizationId: "org-a2-pnl",
      symbol: "BTCUSDT",
      side: "buy" as const,
      fillSequence: 1,
      sourceBarIndex: 1,
      sourceBar: bar,
      grossFillPrice: "25000",
      sliceQuantity: "0.04000000",
      remainingQuantityAfter: "0",
      acceptedAt: new Date("2026-01-01T00:01:00.000Z"),
      fillTimestamp: new Date("2026-01-01T00:01:59.999Z"),
      submitLatencyMs: 50,
      cancelLatencyMs: null,
    };

    const economics = applyHistoricalExecutionEconomics(event, createHistoricalExecutionModelV1());
    const grossNotional = multiplyDecimal(event.grossFillPrice, event.sliceQuantity);
    const expectedFee = multiplyDecimal(grossNotional, "0.0020");
    const expectedSpread = multiplyDecimal(grossNotional, "0.0005");
    const expectedImpact = multiplyDecimal(grossNotional, "0.0010");

    expect(economics.feeAmount).toBe(expectedFee);
    expect(economics.spreadCost).toBe(expectedSpread);
    expect(economics.impactSlippageCost).toBe(expectedImpact);
    expect(economics.totalExecutionCost).toBe(
      addDecimal(addDecimal(expectedFee, expectedSpread), expectedImpact),
    );

    const legacyStack = applyCostToFill(
      economics.netFillPrice,
      event.sliceQuantity,
      event.side,
      createCostModelV1("10", "5"),
    );
    expect(legacyStack.adjustedPrice).not.toBe(economics.netFillPrice);

    const authorityStack = applyCostToFill(
      economics.netFillPrice,
      event.sliceQuantity,
      event.side,
      costModelV1FromAuthority(createHtrHistoricalCostModelAuthorityV1()),
    );
    expect(authorityStack.adjustedPrice).not.toBe(economics.netFillPrice);
    expect(compareDecimal(economics.netFillPrice, event.grossFillPrice)).toBe(1);
  });

  it("checkpoint/resume digest parity preserves authority binding", () => {
    const authority = createHtrHistoricalCostModelAuthorityV1();
    const roundTripped = JSON.parse(JSON.stringify(authority)) as typeof authority;
    expect(roundTripped.costModelDigest).toBe(HTR_FHV_RUN_CONTRACT_V0.costModelDigest);
    expect(computeHtrHistoricalCostModelDigest(roundTripped)).toBe(authority.costModelDigest);
    expect(createHtrHistoricalCostModelAuthorityV1().costModelDigest).toBe(
      roundTripped.costModelDigest,
    );
  });
});
