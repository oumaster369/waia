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
  type HistoricalExecutionModelV1,
  type SimulatedFillEvent,
} from "@/lib/trader/execution/historical-execution-model.types";
import {
  addDecimal,
  compareDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";
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

function fixtureEconomics(side: "buy" | "sell", model = createHistoricalExecutionModelV1()) {
  return applyHistoricalExecutionEconomics(baseEvent({ side }), model);
}

function zeroCostModel(): HistoricalExecutionModelV1 {
  const model = createHistoricalExecutionModelV1();
  return {
    ...model,
    takerFeeBps: "0",
    halfSpreadBpsPerSide: "0",
    impactValueBps: "0",
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

  it("BUY netCashEffect is negative (signed cash delta)", () => {
    const economics = fixtureEconomics("buy");
    expect(compareDecimal(economics.netCashEffect, "0")).toBe(-1);
  });

  it("SELL netCashEffect is positive (signed cash delta)", () => {
    const economics = fixtureEconomics("sell");
    expect(compareDecimal(economics.netCashEffect, "0")).toBe(1);
  });

  it("exact BUY fixture values from §8 regression", () => {
    const economics = fixtureEconomics("buy");
    expect(compareDecimal(economics.grossNotional, "1000")).toBe(0);
    expect(compareDecimal(economics.feeAmount, "2")).toBe(0);
    expect(compareDecimal(economics.spreadCost, "0.5")).toBe(0);
    expect(compareDecimal(economics.impactSlippageCost, "1")).toBe(0);
    expect(compareDecimal(economics.totalExecutionCost, "3.5")).toBe(0);
    expect(compareDecimal(economics.netFillPrice, "10015")).toBe(0);
    expect(compareDecimal(economics.netCashEffect, "-1003.5")).toBe(0);
    expect(compareDecimal(economics.feeAmount, "200000000")).not.toBe(0);
    expect(compareDecimal(economics.netCashEffect, "-199998998.5")).not.toBe(0);
  });

  it("exact SELL fixture values from §8 regression", () => {
    const economics = fixtureEconomics("sell");
    expect(compareDecimal(economics.grossNotional, "1000")).toBe(0);
    expect(compareDecimal(economics.feeAmount, "2")).toBe(0);
    expect(compareDecimal(economics.spreadCost, "0.5")).toBe(0);
    expect(compareDecimal(economics.impactSlippageCost, "1")).toBe(0);
    expect(compareDecimal(economics.totalExecutionCost, "3.5")).toBe(0);
    expect(compareDecimal(economics.netFillPrice, "9985")).toBe(0);
    expect(compareDecimal(economics.netCashEffect, "996.5")).toBe(0);
    expect(compareDecimal(economics.netCashEffect, "0")).toBe(1);
    expect(compareDecimal(economics.netCashEffect, "-200000998.5")).not.toBe(0);
  });

  it("feeAmount equals grossNotional × takerFeeBps / 10000", () => {
    const economics = fixtureEconomics("buy");
    const expectedFee = formatDecimal(
      (parseDecimal(economics.grossNotional) * parseDecimal(model.takerFeeBps) +
        10000n * parseDecimal("0.5")) /
        (10000n * parseDecimal("1")),
    );
    expect(compareDecimal(economics.feeAmount, expectedFee)).toBe(0);
    expect(compareDecimal(economics.feeAmount, "2")).toBe(0);
  });

  it("BUY spread/impact price-to-notional identity holds exactly", () => {
    const economics = fixtureEconomics("buy");
    const priceDelta = subtractDecimal(economics.netFillPrice, economics.grossFillPrice);
    const lhs = multiplyDecimal(priceDelta, economics.quantity);
    const rhs = addDecimal(economics.spreadCost, economics.impactSlippageCost);
    expect(compareDecimal(lhs, rhs)).toBe(0);
    expect(compareDecimal(lhs, "1.5")).toBe(0);
    expect(compareDecimal(rhs, "150000000")).not.toBe(0);
  });

  it("SELL spread/impact price-to-notional identity holds exactly", () => {
    const economics = fixtureEconomics("sell");
    const priceDelta = subtractDecimal(economics.grossFillPrice, economics.netFillPrice);
    const lhs = multiplyDecimal(priceDelta, economics.quantity);
    const rhs = addDecimal(economics.spreadCost, economics.impactSlippageCost);
    expect(compareDecimal(lhs, rhs)).toBe(0);
    expect(compareDecimal(lhs, "1.5")).toBe(0);
  });

  it("totalExecutionCost equals fee + spread + impact exactly", () => {
    const economics = fixtureEconomics("buy");
    const sum = formatDecimal(
      parseDecimal(economics.feeAmount) +
        parseDecimal(economics.spreadCost) +
        parseDecimal(economics.impactSlippageCost),
    );
    expect(compareDecimal(economics.totalExecutionCost, sum)).toBe(0);
    expect(compareDecimal(economics.totalExecutionCost, "3.5")).toBe(0);
  });

  it("zero-cost BUY cash delta equals -grossNotional", () => {
    const economics = applyHistoricalExecutionEconomics(baseEvent(), zeroCostModel());
    expect(compareDecimal(economics.netFillPrice, economics.grossFillPrice)).toBe(0);
    expect(compareDecimal(economics.netCashEffect, "-1000")).toBe(0);
    expect(compareDecimal(economics.netCashEffect, "0")).toBe(-1);
  });

  it("zero-cost SELL cash delta equals +grossNotional", () => {
    const economics = applyHistoricalExecutionEconomics(
      baseEvent({ side: "sell" }),
      zeroCostModel(),
    );
    expect(compareDecimal(economics.netFillPrice, economics.grossFillPrice)).toBe(0);
    expect(compareDecimal(economics.netCashEffect, "1000")).toBe(0);
    expect(compareDecimal(economics.netCashEffect, "0")).toBe(1);
  });

  it("minimum quantity 0.00000001 produces finite economics", () => {
    const economics = applyHistoricalExecutionEconomics(
      baseEvent({ sliceQuantity: "0.00000001" }),
      model,
    );
    expect(compareDecimal(economics.grossNotional, "0.0001")).toBe(0);
    expect(compareDecimal(economics.netCashEffect, "0")).toBe(-1);
    expect(economics.economicsContentDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("HALF_UP boundary: fee rounds up at exact half increment", () => {
    const boundaryModel = { ...model, takerFeeBps: "1" };
    const economics = applyHistoricalExecutionEconomics(
      baseEvent({ grossFillPrice: "5000", sliceQuantity: "0.20000000" }),
      boundaryModel,
    );
    expect(compareDecimal(economics.grossNotional, "1000")).toBe(0);
    expect(compareDecimal(economics.feeAmount, "0.1")).toBe(0);
  });

  it("applies deterministic rounding for repeated invocations", () => {
    const first = applyHistoricalExecutionEconomics(baseEvent(), model);
    const second = applyHistoricalExecutionEconomics(baseEvent(), model);
    expect(second.economicsContentDigest).toBe(first.economicsContentDigest);
    expect(second.feeAmount).toBe(first.feeAmount);
    expect(second.netCashEffect).toBe(first.netCashEffect);
  });

  it("computes stable economics content digest", () => {
    const economics = applyHistoricalExecutionEconomics(baseEvent(), model);
    const { economicsContentDigest, ...withoutDigest } = economics;
    const recomputed = computeEconomicsContentDigest(withoutDigest);
    expect(recomputed).toBe(economicsContentDigest);
    expect(economicsContentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(economicsContentDigest).not.toBe(
      "784c300958759fcf9add48725e1ec0138f1b7a58cff88715891c295430d5619b",
    );
  });

  it("digest sensitivity: changing one economics field changes economics_content_digest", () => {
    const economics = applyHistoricalExecutionEconomics(baseEvent(), model);
    const { economicsContentDigest, ...withoutDigest } = economics;
    const mutated = { ...withoutDigest, feeAmount: "2.00000001" };
    expect(computeEconomicsContentDigest(mutated)).not.toBe(economicsContentDigest);
  });

  it("no scale-1e8 regression in fee/spread/impact/total", () => {
    const economics = fixtureEconomics("buy");
    expect(compareDecimal(economics.feeAmount, "200000000")).not.toBe(0);
    expect(compareDecimal(economics.spreadCost, "50000000")).not.toBe(0);
    expect(compareDecimal(economics.impactSlippageCost, "100000000")).not.toBe(0);
    expect(compareDecimal(economics.totalExecutionCost, "350000000")).not.toBe(0);
  });

  it("BUY sign is negative without relying on corrupt fee magnitude to mask principal sign", () => {
    const lowFeeModel = { ...model, takerFeeBps: "1" };
    const economics = applyHistoricalExecutionEconomics(baseEvent(), lowFeeModel);
    expect(compareDecimal(economics.feeAmount, "0.1")).toBe(0);
    expect(compareDecimal(economics.netCashEffect, "0")).toBe(-1);
    const principalOnly = multiplyDecimal(economics.netFillPrice, economics.quantity);
    expect(
      compareDecimal(economics.netCashEffect, `-${addDecimal(principalOnly, economics.feeAmount)}`),
    ).toBe(0);
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
