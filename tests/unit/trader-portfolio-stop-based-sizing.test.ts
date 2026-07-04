import { describe, expect, it } from "vitest";

import { COST_MODEL_VERSION_V1 } from "@/lib/trader/execution/cost-model";
import type { StrategySignal } from "@/lib/trader/intelligence/types";
import { defaultStopDistanceProvider } from "@/lib/trader/portfolio/default-stop-distance-provider";
import { createInitialPortfolioAccountState } from "@/lib/trader/portfolio/derive-portfolio-account-state";
import { DEFAULT_PORTFOLIO_RUN_CONFIG } from "@/lib/trader/portfolio/portfolio-run-config.types";
import type { StopDistanceProvider } from "@/lib/trader/portfolio/stop-distance-provider.types";
import {
  computeStopBasedQuantity,
  trimQtyToAffordable,
} from "@/lib/trader/portfolio/stop-based-sizing";

const SIGNAL: StrategySignal = {
  strategySignalId: "sig-1",
  strategyId: "mean_reversion_v0",
  strategyVersion: "0",
  organizationId: "org-1",
  symbol: "BTC/USDT",
  outcome: "SIGNAL",
  side: "buy",
  reasonCodes: [],
  msvId: "msv-1",
  featureSetId: "fs-1",
  evaluatedAt: "2026-01-01T00:00:00.000Z",
};

const WIDE_LIMITS = {
  maxRiskPerTradePct: "0.01",
  maxPortfolioRiskPct: "0.50",
  maxConcurrentPositions: 10,
  maxNotional: "100000.00",
};

const COST_MODEL = {
  version: COST_MODEL_VERSION_V1,
  feesBps: "10",
  slippageBps: "5",
};

const zeroStopProvider: StopDistanceProvider = {
  resolveStopDistance: () => ({ stopDistanceUsdt: "0", source: "RUN_DEFAULT_PCT" }),
};

describe("computeStopBasedQuantity (M2)", () => {
  it("sizes from equity, stop distance, and risk pct", () => {
    const account = createInitialPortfolioAccountState({
      runConfig: { ...DEFAULT_PORTFOLIO_RUN_CONFIG, startingBalanceUsdt: "100000.00" },
      limits: WIDE_LIMITS,
      stopDistanceProvider: defaultStopDistanceProvider,
    });

    const result = computeStopBasedQuantity({
      side: "buy",
      signal: SIGNAL,
      entryPrice: "65000.00",
      defaultQuantity: "1",
      account,
      limits: WIDE_LIMITS,
      stopDistanceProvider: defaultStopDistanceProvider,
      runConfig: { ...DEFAULT_PORTFOLIO_RUN_CONFIG, defaultStopDistancePct: "0.02" },
      costModel: COST_MODEL,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stopDistanceSource).toBe("RUN_DEFAULT_PCT");
      expect(result.stopDistanceUsdt).toBe("1300");
      expect(result.quantity).toBe("0.76923076");
    }
  });

  it("rejects dust-sized quantity", () => {
    const account = createInitialPortfolioAccountState({
      runConfig: { ...DEFAULT_PORTFOLIO_RUN_CONFIG, startingBalanceUsdt: "1.00" },
      limits: WIDE_LIMITS,
      stopDistanceProvider: defaultStopDistanceProvider,
    });

    const result = computeStopBasedQuantity({
      side: "buy",
      signal: SIGNAL,
      entryPrice: "65000.00",
      defaultQuantity: "0.01",
      account,
      limits: WIDE_LIMITS,
      stopDistanceProvider: defaultStopDistanceProvider,
      runConfig: DEFAULT_PORTFOLIO_RUN_CONFIG,
      costModel: COST_MODEL,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("PORTFOLIO_BELOW_MIN_QTY");
    }
  });

  it("per-trade risk pct cap binds before default quantity", () => {
    const account = createInitialPortfolioAccountState({
      runConfig: { ...DEFAULT_PORTFOLIO_RUN_CONFIG, startingBalanceUsdt: "10000.00" },
      limits: { ...WIDE_LIMITS, maxRiskPerTradePct: "0.001" },
      stopDistanceProvider: defaultStopDistanceProvider,
    });

    const result = computeStopBasedQuantity({
      side: "buy",
      signal: SIGNAL,
      entryPrice: "100.00",
      defaultQuantity: "100",
      account,
      limits: { ...WIDE_LIMITS, maxRiskPerTradePct: "0.001" },
      stopDistanceProvider: defaultStopDistanceProvider,
      runConfig: { ...DEFAULT_PORTFOLIO_RUN_CONFIG, defaultStopDistancePct: "0.02" },
      costModel: COST_MODEL,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quantity).toBe("5");
    }
  });

  it("portfolio risk cap binds when open risk consumes budget", () => {
    const account = createInitialPortfolioAccountState({
      runConfig: { ...DEFAULT_PORTFOLIO_RUN_CONFIG, startingBalanceUsdt: "10000.00" },
      limits: WIDE_LIMITS,
      stopDistanceProvider: defaultStopDistanceProvider,
    });
    account.openRiskUsdt = "499";
    account.openPositionCount = 1;
    account.positions = [
      {
        symbol: "ETH/USDT",
        quantity: "0.01",
        avgCost: "3000",
        markPrice: "3000",
        unrealizedPnlUsdt: "0",
        riskAtStopUsdt: "450",
        stopDistanceUsdt: "60",
      },
    ];

    const result = computeStopBasedQuantity({
      side: "buy",
      signal: SIGNAL,
      entryPrice: "100.00",
      defaultQuantity: "10",
      account,
      limits: { ...WIDE_LIMITS, maxPortfolioRiskPct: "0.05" },
      stopDistanceProvider: defaultStopDistanceProvider,
      runConfig: { ...DEFAULT_PORTFOLIO_RUN_CONFIG, defaultStopDistancePct: "0.02" },
      costModel: COST_MODEL,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quantity).toBe("0.5");
    }
  });

  it("notional cap binds independently", () => {
    const account = createInitialPortfolioAccountState({
      runConfig: { ...DEFAULT_PORTFOLIO_RUN_CONFIG, startingBalanceUsdt: "100000.00" },
      limits: WIDE_LIMITS,
      stopDistanceProvider: defaultStopDistanceProvider,
    });

    const result = computeStopBasedQuantity({
      side: "buy",
      signal: SIGNAL,
      entryPrice: "10000.00",
      defaultQuantity: "10",
      account,
      limits: { ...WIDE_LIMITS, maxNotional: "5000.00" },
      stopDistanceProvider: defaultStopDistanceProvider,
      runConfig: DEFAULT_PORTFOLIO_RUN_CONFIG,
      costModel: COST_MODEL,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quantity).toBe("0.5");
    }
  });

  it("rejects invalid stop distance from provider", () => {
    const account = createInitialPortfolioAccountState({
      runConfig: DEFAULT_PORTFOLIO_RUN_CONFIG,
      limits: WIDE_LIMITS,
      stopDistanceProvider: zeroStopProvider,
    });

    const result = computeStopBasedQuantity({
      side: "buy",
      signal: SIGNAL,
      entryPrice: "65000.00",
      defaultQuantity: "0.01",
      account,
      limits: WIDE_LIMITS,
      stopDistanceProvider: zeroStopProvider,
      runConfig: DEFAULT_PORTFOLIO_RUN_CONFIG,
      costModel: COST_MODEL,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("RISK_INVALID_STOP_DISTANCE");
    }
  });
});

describe("trimQtyToAffordable (M2)", () => {
  it("trims quantity when fee-aware buy cost exceeds available balance", () => {
    const trimmed = trimQtyToAffordable("100.00", "1", "50.00", COST_MODEL);
    expect(trimmed).not.toBe("1");
    expect(Number(trimmed)).toBeGreaterThan(0);
    expect(Number(trimmed)).toBeLessThan(1);
  });
});
