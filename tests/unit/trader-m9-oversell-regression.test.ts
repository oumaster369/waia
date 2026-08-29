import { describe, expect, it } from "vitest";

import { evaluatePositionGuardian } from "@/lib/trader/guardian/evaluate-position-guardian";
import type { GuardianRunConfig } from "@/lib/trader/guardian/guardian-run-config.types";
import type { EvaluationCycleResult } from "@/lib/trader/intelligence/types";
import type { PositionLotRow, TradeRow } from "@/lib/trader/lifecycle/trade-lifecycle.types";
import type { MarketSnapshot } from "@/lib/trader/market-data/types";
import { evaluateCapitalLimits } from "@/lib/trader/risk/capital-limits-evaluator";
import { capitalReasonCodes } from "@/lib/trader/risk/reason-codes";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG = "00000000-0000-4000-8000-0000000378";
const context = requireOrgContext(ORG);

function mockEvaluation(): EvaluationCycleResult {
  return {
    features: {
      featureSetId: "fs-m9",
      instrumentId: "BTC/USDT",
      evaluatedAt: "2026-01-02T00:00:00.000Z",
      features: {
        close: "65000",
        sma20: "64000",
        zscoreVsSma20: "0",
        priceDispersion20: "300",
        spreadBps: "1",
      },
      dataQualityScore: 0.9,
      inputs: { barCount: 25 },
    },
    msv: {
      msvId: "msv-m9",
      instrumentId: "BTC/USDT",
      evaluatedAt: "2026-01-02T00:00:00.000Z",
      featureSetId: "fs-m9",
      physics: { close: "65000", zscoreVsSma20: "0", priceDispersion20: "300" },
      liquidity: { spreadBps: "1" },
      crowd: { fearGreedIndex: null, newsSentiment: "neutral" },
      futureContext: { eventRiskScore: "0" },
      derived: {
        regime: "RANGE",
        tradingPermission: "ALLOW_TRADING",
        allowedStrategyIds: ["mean_reversion_v0"],
        riskMultiplier: "1",
        dataQualityScore: 0.9,
        reasonCodes: [],
      },
    },
    signals: [],
    signal: {
      strategySignalId: "signal-m9",
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.6",
      organizationId: ORG,
      symbol: "BTC/USDT",
      outcome: "NO_SIGNAL",
      side: undefined,
      confidence: "0",
      expectedEdge: "0",
      horizon: "1h",
      maxRisk: "0",
      reasonCodes: [],
      msvId: "msv-m9",
      featureSetId: "fs-m9",
      evaluatedAt: "2026-01-02T00:00:00.000Z",
    },
  };
}

function mockLot(overrides: Partial<PositionLotRow>): PositionLotRow {
  return {
    id: "lot-1",
    organizationId: ORG,
    symbol: "BTC/USDT",
    venue: "mock",
    accountKey: "paper",
    positionSide: "LONG",
    instrumentKind: "SPOT",
    strategySignalId: "sig-1",
    state: "OPEN",
    openQty: "0.005",
    remainingQty: "0.005",
    avgCost: "64000",
    openedAt: new Date("2026-01-01T00:00:00.000Z"),
    closedAt: null,
    tradeId: "trade-1",
    hedgeGroupId: null,
    targetLotId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function mockTrade(tradeId: string): TradeRow {
  return {
    id: tradeId,
    organizationId: ORG,
    symbol: "BTC/USDT",
    venue: "mock",
    accountKey: "paper",
    positionSide: "LONG",
    instrumentKind: "SPOT",
    strategySignalId: "sig-1",
    strategyId: "mean_reversion_v0",
    strategyVersion: "0.1.6",
    state: "OPEN",
    semanticsVersion: "waia.trader.trade-lifecycle.v2",
    openedAt: new Date("2026-01-01T00:00:00.000Z"),
    closedAt: null,
    realizedPnl: "0",
    markedPnl: "0",
    hypothesisId: null,
    patternId: null,
    riskDecisionId: "risk-m9",
    allocationDecisionId: null,
    reasoningSessionId: null,
    signalConfidence: null,
    openingRegime: "RANGE",
    openingMsvId: "msv-m9",
    openingFeatureSetId: "fs-m9",
    closingMsvId: null,
    closingFeatureSetId: null,
    closingRegime: null,
    frozenAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function mockSnapshot(): MarketSnapshot {
  return {
    cycleId: "cycle-m9",
    cycleIndex: 1,
    evaluatedAt: "2026-01-02T00:00:00.000Z",
    bars: [],
    quote: {
      symbol: "BTC/USDT",
      bid: "64900",
      ask: "65100",
      last: "65000",
      timestamp: "2026-01-02T00:00:00.000Z",
    },
  };
}

describe("M9 v0.1.6 oversell regression (PR1)", () => {
  it("caps multi-lot guardian batch exits to canonical symbol inventory", () => {
    const runConfig: GuardianRunConfig = {
      enabled: true,
      maxHoldBars: 1,
    };
    const lot1 = mockLot({
      id: "lot-1",
      tradeId: "trade-1",
      remainingQty: "0.005",
      openQty: "0.005",
    });
    const lot2 = mockLot({
      id: "lot-2",
      tradeId: "trade-2",
      remainingQty: "0.005",
      openQty: "0.005",
      openedAt: new Date("2026-01-01T00:01:00.000Z"),
    });
    const openQtyBySymbol = new Map([["BTC/USDT", "0.00731991"]]);

    const result = evaluatePositionGuardian({
      context,
      snapshot: mockSnapshot(),
      evaluation: mockEvaluation(),
      openLots: [lot1, lot2],
      tradesById: new Map([
        ["trade-1", mockTrade("trade-1")],
        ["trade-2", mockTrade("trade-2")],
      ]),
      runConfig,
      accountKey: "paper",
      markPrice: "65000",
      canonicalInventory: { openQtyBySymbol },
    });

    const totalExitQty = result.exitIntents.reduce(
      (sum, intent) => (intent.symbol === "BTC/USDT" ? sum + Number(intent.quantity) : sum),
      0,
    );
    expect(totalExitQty).toBeCloseTo(0.00731991, 8);
    expect(result.exitIntents.length).toBe(2);

    const partialIntent = result.exitIntents.find((intent) => intent.positionLotId === "lot-2");
    expect(partialIntent?.kind).toBe("REDUCE_LONG");
    expect(partialIntent?.reason.decision).toBe("EXIT_PARTIAL");
    expect(partialIntent?.reason.reasonCode).toBe("GUARDIAN_INVENTORY_CAPPED_PARTIAL");
    expect(partialIntent?.reason.inventoryCapApplied).toBe(true);
    expect(Number(partialIntent?.quantity)).toBeCloseTo(0.00231991, 8);
  });

  it("rejects sell quantity exceeding held position in risk engine", () => {
    const decision = evaluateCapitalLimits(
      {
        order: {
          symbol: "BTC/USDT",
          side: "sell",
          type: "market",
          quantity: "0.00866055",
          clientOrderId: "client-oversell",
        },
        referencePrice: "65000",
        accountState: {
          drawdown: "0",
          dailyPnl: "0",
          openOrderCount: 0,
          positions: [{ symbol: "BTC/USDT", quantity: "0.00731991" }],
          quoteExposureByCurrency: { USDT: "0" },
        },
      },
      DEFAULT_ORG_RISK_LIMITS,
      { nowMs: () => Date.now() },
    );

    expect(decision.outcome).toBe("REJECT");
    expect(decision.reasonCodes).toContain(capitalReasonCodes.sellExceedsOpenQuantity);
  });
});
