import { applyHistoricalExecutionEconomics } from "@/lib/trader/execution/fill-economics";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import type { SimulatedFillEvent } from "@/lib/trader/execution/historical-execution-model.types";
import { makeWp17Bar } from "@/tests/unit/helpers/wp17-execution-fixtures";

const model = createHistoricalExecutionModelV1();

export function makeAccountingEconomicsFill(
  side: "buy" | "sell",
  overrides?: Partial<SimulatedFillEvent>,
) {
  const bar = makeWp17Bar(1);
  const event: SimulatedFillEvent = {
    orderId: "order-accounting",
    organizationId: "org-accounting",
    symbol: "BTCUSDT",
    side,
    fillSequence: 1,
    sourceBarIndex: 1,
    sourceBar: bar,
    grossFillPrice: "10000",
    sliceQuantity: "0.10000000",
    remainingQuantityAfter: "0",
    acceptedAt: new Date("2026-01-01T00:01:00.000Z"),
    fillTimestamp: new Date("2026-01-01T00:01:59.999Z"),
    submitLatencyMs: 50,
    cancelLatencyMs: null,
    ...overrides,
  };
  const economics = applyHistoricalExecutionEconomics(event, model);
  return {
    fillId: crypto.randomUUID(),
    economics: {
      symbol: event.symbol,
      side: event.side,
      quantity: event.sliceQuantity,
      grossFillPrice: economics.grossFillPrice,
      grossNotional: economics.grossNotional,
      netFillPrice: economics.netFillPrice,
      feeAmount: economics.feeAmount,
      netCashEffect: economics.netCashEffect,
      spreadCost: economics.spreadCost,
      impactSlippageCost: economics.impactSlippageCost,
      totalExecutionCost: economics.totalExecutionCost,
      economicsContentDigest: economics.economicsContentDigest,
    },
    executedAt: event.fillTimestamp.toISOString(),
  };
}

export const BTC_MARK = { price: "50000", barCloseTime: "2026-01-01T00:01:59.999Z" };
export const ETH_MARK = { price: "3000", barCloseTime: "2026-01-01T00:01:59.999Z" };
