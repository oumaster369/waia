import { describe, expect, it } from "vitest";

import {
  capitalReasonCodes,
  evaluateCapitalLimits,
  type AccountRiskState,
  type CapitalLimitsConfig,
} from "@/lib/trader/risk";

const PERMISSIVE_CONFIG: CapitalLimitsConfig = {
  maxPositionPerSymbol: "1",
  maxDailyLoss: "500",
  maxDrawdown: "1000",
  maxOpenOrders: 10,
  maxQuoteExposure: "10000",
  maxRiskPerTradePct: "0.01",
  maxPortfolioRiskPct: "0.05",
  maxConcurrentPositions: 3,
};

const BASELINE_STATE: AccountRiskState = {
  positions: [{ symbol: "BTC/USDT", quantity: "0.10" }],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: { USDT: "6500" },
};

function createDeps(nowMs = 1_700_000_000_000) {
  return { nowMs: () => nowMs };
}

describe("trader capital limits evaluator (DEE-240)", () => {
  it("approves an order within all capital limits", () => {
    const decision = evaluateCapitalLimits(
      {
        order: {
          clientOrderId: "cap-approve-1",
          symbol: "BTC/USDT",
          side: "buy",
          type: "limit",
          price: "65000.00",
          quantity: "0.01",
        },
        referencePrice: "65000.00",
        accountState: BASELINE_STATE,
      },
      PERMISSIVE_CONFIG,
      createDeps(),
    );

    expect(decision.outcome).toBe("APPROVE");
    expect(decision.reasonCodes).toEqual([]);
    expect(decision.snapshot.computedNotional).toBe("650");
    expect(decision.snapshot.checksApplied).toEqual([
      "drawdown",
      "dailyLoss",
      "openOrders",
      "position",
      "quoteExposure",
    ]);
  });

  it("returns STOP_ACCOUNT when drawdown is at or above max", () => {
    const decision = evaluateCapitalLimits(
      {
        order: {
          clientOrderId: "cap-drawdown",
          symbol: "BTC/USDT",
          side: "buy",
          type: "limit",
          price: "65000.00",
          quantity: "0.01",
        },
        referencePrice: "65000.00",
        accountState: { ...BASELINE_STATE, drawdown: "1000" },
      },
      PERMISSIVE_CONFIG,
      createDeps(),
    );

    expect(decision.outcome).toBe("STOP_ACCOUNT");
    expect(decision.reasonCodes).toEqual([capitalReasonCodes.maxDrawdownExceeded]);
    expect(decision.snapshot.checksApplied).toEqual(["drawdown"]);
  });

  it("rejects when daily PnL exceeds max daily loss", () => {
    const decision = evaluateCapitalLimits(
      {
        order: {
          clientOrderId: "cap-daily-loss",
          symbol: "BTC/USDT",
          side: "buy",
          type: "limit",
          price: "65000.00",
          quantity: "0.01",
        },
        referencePrice: "65000.00",
        accountState: { ...BASELINE_STATE, dailyPnl: "-500" },
      },
      PERMISSIVE_CONFIG,
      createDeps(),
    );

    expect(decision.outcome).toBe("REJECT");
    expect(decision.reasonCodes).toEqual([capitalReasonCodes.maxDailyLossExceeded]);
    expect(decision.snapshot.checksApplied).toEqual(["drawdown", "dailyLoss"]);
  });

  it("rejects when open order count is at cap", () => {
    const decision = evaluateCapitalLimits(
      {
        order: {
          clientOrderId: "cap-open-orders",
          symbol: "BTC/USDT",
          side: "buy",
          type: "limit",
          price: "65000.00",
          quantity: "0.01",
        },
        referencePrice: "65000.00",
        accountState: { ...BASELINE_STATE, openOrderCount: 10 },
      },
      { ...PERMISSIVE_CONFIG, maxOpenOrders: 10 },
      createDeps(),
    );

    expect(decision.outcome).toBe("REJECT");
    expect(decision.reasonCodes).toEqual([capitalReasonCodes.maxOpenOrdersExceeded]);
  });

  it("returns CLOSE_ONLY when buy would exceed max position per symbol", () => {
    const decision = evaluateCapitalLimits(
      {
        order: {
          clientOrderId: "cap-position-buy",
          symbol: "BTC/USDT",
          side: "buy",
          type: "limit",
          price: "65000.00",
          quantity: "0.95",
        },
        referencePrice: "65000.00",
        accountState: BASELINE_STATE,
      },
      { ...PERMISSIVE_CONFIG, maxPositionPerSymbol: "1" },
      createDeps(),
    );

    expect(decision.outcome).toBe("CLOSE_ONLY");
    expect(decision.reasonCodes).toEqual([capitalReasonCodes.maxPositionPerSymbolExceeded]);
  });

  it("approves sell reducing position when at position cap", () => {
    const decision = evaluateCapitalLimits(
      {
        order: {
          clientOrderId: "cap-position-sell",
          symbol: "BTC/USDT",
          side: "sell",
          type: "limit",
          price: "65000.00",
          quantity: "0.05",
        },
        referencePrice: "65000.00",
        accountState: BASELINE_STATE,
      },
      { ...PERMISSIVE_CONFIG, maxPositionPerSymbol: "0.10" },
      createDeps(),
    );

    expect(decision.outcome).toBe("APPROVE");
  });

  it("aggregates multiple position rows for the same symbol", () => {
    const decision = evaluateCapitalLimits(
      {
        order: {
          clientOrderId: "cap-position-aggregate",
          symbol: "BTC/USDT",
          side: "buy",
          type: "limit",
          price: "65000.00",
          quantity: "0.01",
        },
        referencePrice: "65000.00",
        accountState: {
          ...BASELINE_STATE,
          positions: [
            { symbol: "BTC/USDT", quantity: "0.05" },
            { symbol: "BTC/USDT", quantity: "0.05" },
          ],
        },
      },
      { ...PERMISSIVE_CONFIG, maxPositionPerSymbol: "0.10" },
      createDeps(),
    );

    expect(decision.outcome).toBe("CLOSE_ONLY");
    expect(decision.reasonCodes).toEqual([capitalReasonCodes.maxPositionPerSymbolExceeded]);
  });

  it("rejects when buy exceeds max quote exposure", () => {
    const decision = evaluateCapitalLimits(
      {
        order: {
          clientOrderId: "cap-quote-exposure",
          symbol: "BTC/USDT",
          side: "buy",
          type: "limit",
          price: "65000.00",
          quantity: "0.10",
        },
        referencePrice: "65000.00",
        accountState: BASELINE_STATE,
      },
      { ...PERMISSIVE_CONFIG, maxQuoteExposure: "7000" },
      createDeps(),
    );

    expect(decision.outcome).toBe("REJECT");
    expect(decision.reasonCodes).toEqual([capitalReasonCodes.maxQuoteExposureExceeded]);
  });

  it("uses referencePrice for market order notional", () => {
    const decision = evaluateCapitalLimits(
      {
        order: {
          clientOrderId: "cap-market",
          symbol: "BTC/USDT",
          side: "buy",
          type: "market",
          quantity: "0.01",
        },
        referencePrice: "65000.00",
        accountState: BASELINE_STATE,
      },
      PERMISSIVE_CONFIG,
      createDeps(),
    );

    expect(decision.outcome).toBe("APPROVE");
    expect(decision.snapshot.effectivePrice).toBe("65000.00");
    expect(decision.snapshot.computedNotional).toBe("650");
  });

  it("requires referencePrice for market orders", () => {
    expect(() =>
      evaluateCapitalLimits(
        {
          order: {
            clientOrderId: "cap-market-missing-ref",
            symbol: "BTC/USDT",
            side: "buy",
            type: "market",
            quantity: "0.01",
          },
          referencePrice: "0",
          accountState: BASELINE_STATE,
        },
        PERMISSIVE_CONFIG,
        createDeps(),
      ),
    ).toThrow(/referencePrice/);
  });

  it("rejects when open position count is at concurrent cap", () => {
    const decision = evaluateCapitalLimits(
      {
        order: {
          clientOrderId: "cap-concurrent",
          symbol: "ETH/USDT",
          side: "buy",
          type: "limit",
          price: "3000.00",
          quantity: "0.01",
        },
        referencePrice: "3000.00",
        accountState: {
          ...BASELINE_STATE,
          openPositionCount: 3,
          positions: [{ symbol: "BTC/USDT", quantity: "0.01" }],
        },
        stopDistanceUsdt: "60",
      },
      PERMISSIVE_CONFIG,
      createDeps(),
    );

    expect(decision.outcome).toBe("REJECT");
    expect(decision.reasonCodes).toEqual([capitalReasonCodes.maxConcurrentPositionsExceeded]);
  });

  it("rejects when projected portfolio risk exceeds cap", () => {
    const decision = evaluateCapitalLimits(
      {
        order: {
          clientOrderId: "cap-portfolio-risk",
          symbol: "BTC/USDT",
          side: "buy",
          type: "limit",
          price: "65000.00",
          quantity: "0.50",
        },
        referencePrice: "65000.00",
        accountState: {
          positions: [],
          openOrderCount: 0,
          dailyPnl: "0",
          drawdown: "0",
          quoteExposureByCurrency: {},
          equityUsdt: "10000",
          openRiskUsdt: "400",
          openPositionCount: 1,
        },
        stopDistanceUsdt: "1300",
      },
      { ...PERMISSIVE_CONFIG, maxPositionPerSymbol: "2", maxQuoteExposure: "50000" },
      createDeps(),
    );

    expect(decision.outcome).toBe("REJECT");
    expect(decision.reasonCodes).toEqual([capitalReasonCodes.maxPortfolioRiskExceeded]);
  });

  it("rejects buy when available balance is insufficient", () => {
    const decision = evaluateCapitalLimits(
      {
        order: {
          clientOrderId: "cap-available-balance",
          symbol: "BTC/USDT",
          side: "buy",
          type: "limit",
          price: "65000.00",
          quantity: "0.10",
        },
        referencePrice: "65000.00",
        accountState: {
          positions: [],
          openOrderCount: 0,
          dailyPnl: "0",
          drawdown: "0",
          quoteExposureByCurrency: {},
          availableBalanceUsdt: "1000",
        },
      },
      { ...PERMISSIVE_CONFIG, maxQuoteExposure: "20000" },
      createDeps(),
    );

    expect(decision.outcome).toBe("REJECT");
    expect(decision.reasonCodes).toEqual([capitalReasonCodes.insufficientAvailableBalance]);
  });

  it("rejects when stop distance is zero or negative", () => {
    const decision = evaluateCapitalLimits(
      {
        order: {
          clientOrderId: "cap-invalid-stop",
          symbol: "BTC/USDT",
          side: "buy",
          type: "limit",
          price: "65000.00",
          quantity: "0.01",
        },
        referencePrice: "65000.00",
        accountState: BASELINE_STATE,
        stopDistanceUsdt: "0",
      },
      PERMISSIVE_CONFIG,
      createDeps(),
    );

    expect(decision.outcome).toBe("REJECT");
    expect(decision.reasonCodes).toEqual([capitalReasonCodes.invalidStopDistance]);
  });
});
