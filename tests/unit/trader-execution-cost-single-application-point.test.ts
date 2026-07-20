import { describe, expect, it } from "vitest";

import { applyCostToFill, createCostModelV1 } from "@/lib/trader/execution/cost-model";
import {
  applyHistoricalExecutionEconomics,
  computeEconomicsContentDigest,
} from "@/lib/trader/execution/fill-economics";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import type { SimulatedFillEvent } from "@/lib/trader/execution/historical-execution-model.types";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import { makeWp17Bar } from "@/tests/unit/helpers/wp17-execution-fixtures";

function sampleEvent(): SimulatedFillEvent {
  const bar = makeWp17Bar(1);
  return {
    orderId: "order-single-cost",
    organizationId: "org-single-cost",
    symbol: "BTCUSDT",
    side: "buy",
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
}

describe("HTR-WP17 single execution cost application point", () => {
  const model = createHistoricalExecutionModelV1();

  it("applies historical economics exactly once per simulated fill event", () => {
    const event = sampleEvent();
    const economics = applyHistoricalExecutionEconomics(event, model);
    const secondPass = applyHistoricalExecutionEconomics(event, model);

    expect(secondPass.economicsContentDigest).toBe(economics.economicsContentDigest);
    expect(compareDecimal(economics.netFillPrice, economics.grossFillPrice)).toBe(1);
  });

  it("does not stack legacy cost-model adjustments on top of historical economics", () => {
    const event = sampleEvent();
    const economics = applyHistoricalExecutionEconomics(event, model);
    const legacyCostModel = createCostModelV1("20", "15");
    const doubleAdjusted = applyCostToFill(
      economics.netFillPrice,
      event.sliceQuantity,
      event.side,
      legacyCostModel,
    );

    expect(doubleAdjusted.adjustedPrice).not.toBe(economics.netFillPrice);
    expect(doubleAdjusted.fee).not.toBe(economics.feeAmount);
    expect(compareDecimal(economics.netFillPrice, event.grossFillPrice)).toBe(1);
  });

  it("binds digest to economics fields excluding createdAt metadata", () => {
    const economics = applyHistoricalExecutionEconomics(sampleEvent(), model);
    const { economicsContentDigest, ...payload } = economics;
    const digest = computeEconomicsContentDigest(payload);
    expect(digest).toBe(economicsContentDigest);
    expect(economicsContentDigest).toMatch(/^[0-9a-f]{64}$/);
  });
});
