import { describe, expect, it } from "vitest";

import {
  applyHistoricalExecutionEconomics,
  assertCompleteHistoricalFillEconomics,
  computeEconomicsContentDigest,
  FillEconomicsInvariantError,
} from "@/lib/trader/execution/fill-economics";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import {
  EXECUTION_FACT_KIND_HISTORICAL_SIMULATED,
  type SimulatedFillEvent,
} from "@/lib/trader/execution/historical-execution-model.types";
import { compareDecimal, formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import { makeWp17Bar } from "@/tests/unit/helpers/wp17-execution-fixtures";

function baseEvent(overrides?: Partial<SimulatedFillEvent>): SimulatedFillEvent {
  const bar = makeWp17Bar(1);
  return {
    orderId: "order-wp17-econ",
    organizationId: "org-wp17-econ",
    symbol: "BTCUSDT",
    side: "buy",
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
}

describe("HTR-WP17 fill economics", () => {
  const model = createHistoricalExecutionModelV1();

  it("decomposes gross fill into fee, spread, impact, and net cash (D-5 bps)", () => {
    const economics = applyHistoricalExecutionEconomics(baseEvent(), model);
    const componentTotal = formatDecimal(
      parseDecimal(economics.feeAmount) +
        parseDecimal(economics.spreadCost) +
        parseDecimal(economics.impactSlippageCost),
    );

    expect(compareDecimal(economics.grossNotional, "1000")).toBe(0);
    expect(compareDecimal(economics.totalExecutionCost, componentTotal)).toBe(0);
    expect(compareDecimal(economics.netFillPrice, economics.grossFillPrice)).toBe(1);
    expect(compareDecimal(economics.netCashEffect, "0")).toBe(-1);
    expect(economics.executionFactKind).toBe(EXECUTION_FACT_KIND_HISTORICAL_SIMULATED);
    expect(model.takerFeeBps).toBe("20");
    expect(model.halfSpreadBpsPerSide).toBe("5");
    expect(model.impactValueBps).toBe("10");
  });

  it("applies deterministic rounding for repeated invocations", () => {
    const first = applyHistoricalExecutionEconomics(baseEvent(), model);
    const second = applyHistoricalExecutionEconomics(baseEvent(), model);
    expect(second.economicsContentDigest).toBe(first.economicsContentDigest);
    expect(second.feeAmount).toBe(first.feeAmount);
  });

  it("computes stable economics content digest", () => {
    const economics = applyHistoricalExecutionEconomics(baseEvent(), model);
    const { economicsContentDigest, ...withoutDigest } = economics;
    const recomputed = computeEconomicsContentDigest(withoutDigest);
    expect(recomputed).toBe(economicsContentDigest);
    expect(economicsContentDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("assertCompleteHistoricalFillEconomics enforces all-or-none payload", () => {
    const economics = applyHistoricalExecutionEconomics(baseEvent(), model);
    const complete = {
      orderId: "order-1",
      exchangeTradeId: "trade-1",
      price: economics.netFillPrice,
      quantity: "0.10000000",
      fee: economics.feeAmount,
      feeAsset: "USDT",
      executedAt: new Date(),
      executionFactKind: EXECUTION_FACT_KIND_HISTORICAL_SIMULATED,
      economics,
      fillId: crypto.randomUUID(),
      economicsRow: {
        id: crypto.randomUUID(),
        organizationId: "org-1",
        fillId: crypto.randomUUID(),
        orderId: "order-1",
        exchangeTradeId: "trade-1",
        fillSequence: 1,
        symbol: "BTCUSDT",
        side: "buy" as const,
        quantity: "0.10000000",
        grossFillPrice: economics.grossFillPrice,
        grossNotional: economics.grossNotional,
        feeAmount: economics.feeAmount,
        feeAsset: economics.feeAsset,
        spreadCost: economics.spreadCost,
        impactSlippageCost: economics.impactSlippageCost,
        totalExecutionCost: economics.totalExecutionCost,
        netFillPrice: economics.netFillPrice,
        netCashEffect: economics.netCashEffect,
        remainingQuantityAfter: "0",
        executionModelId: economics.executionModelId,
        executionModelSchemaVersion: economics.executionModelSchemaVersion,
        simulatorId: economics.simulatorId,
        simulatorVersion: economics.simulatorVersion,
        sourceBarTimestamp: economics.sourceBarTimestamp,
        sourceBarIndex: economics.sourceBarIndex,
        acceptedAt: economics.acceptedAt,
        fillTimestamp: economics.fillTimestamp,
        submitLatencyMs: economics.submitLatencyMs,
        cancelLatencyMs: economics.cancelLatencyMs,
        executionFactKind: EXECUTION_FACT_KIND_HISTORICAL_SIMULATED,
        economicsContentDigest: economics.economicsContentDigest,
        schemaVersion: "htr-fill-execution-economics/v1",
      },
    };

    expect(() => assertCompleteHistoricalFillEconomics(complete)).not.toThrow();

    expect(() =>
      assertCompleteHistoricalFillEconomics({ ...complete, economics: undefined }),
    ).toThrow(FillEconomicsInvariantError);

    expect(() =>
      assertCompleteHistoricalFillEconomics({
        ...complete,
        economics: { ...economics, economicsContentDigest: "deadbeef".repeat(8) },
      }),
    ).toThrow(FillEconomicsInvariantError);
  });
});
