import { describe, expect, it } from "vitest";

import { decideGuardianAction } from "@/lib/trader/guardian";
import {
  buildExitPlan,
  createSlTpGuardianRuleProvider,
  updateTrailingSessionState,
} from "@/lib/trader/exits/exit-plan-builder";
import { exitReasonCodes, exitRuleIds } from "@/lib/trader/exits/exit-reason-codes";
import { DEFAULT_EXIT_RUN_CONFIG } from "@/lib/trader/exits/exit-types";
import type { Bar } from "@/lib/trader/intelligence/types";
import type { PositionLotRow, TradeRow } from "@/lib/trader/lifecycle/trade-lifecycle.types";
import { TRADE_LIFECYCLE_SEMANTICS_VERSION_V2 } from "@/lib/trader/lifecycle/trade-lifecycle-semantics";

function makeBar(index: number, close: string, high?: string, low?: string): Bar {
  const ts = `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`;
  return {
    symbol: "BTC/USDT",
    interval: "1m",
    open: close,
    high: high ?? close,
    low: low ?? close,
    close,
    volume: "1",
    barOpenTime: ts,
    barCloseTime: ts,
  };
}

function makeLot(overrides?: Partial<PositionLotRow>): PositionLotRow {
  return {
    id: "lot-1",
    organizationId: "org-1",
    symbol: "BTC/USDT",
    venue: "mock",
    accountKey: "acct-1",
    positionSide: "LONG",
    instrumentKind: "SPOT",
    strategySignalId: "sig-1",
    state: "OPEN",
    openQty: "1",
    remainingQty: "1",
    avgCost: "100",
    tradeId: "trade-1",
    openedAt: new Date("2026-01-01T00:00:00.000Z"),
    closedAt: null,
    hedgeGroupId: null,
    targetLotId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeTrade(): TradeRow {
  return {
    id: "trade-1",
    organizationId: "org-1",
    symbol: "BTC/USDT",
    venue: "mock",
    accountKey: "acct-1",
    positionSide: "LONG",
    instrumentKind: "SPOT",
    strategySignalId: "sig-1",
    strategyId: "mean_reversion_v0",
    strategyVersion: "v0",
    state: "OPEN",
    semanticsVersion: TRADE_LIFECYCLE_SEMANTICS_VERSION_V2,
    openedAt: new Date("2026-01-01T00:00:00.000Z"),
    closedAt: null,
    realizedPnl: "0",
    markedPnl: "0",
    hypothesisId: null,
    patternId: null,
    riskDecisionId: "risk-1",
    allocationDecisionId: null,
    reasoningSessionId: null,
    signalConfidence: null,
    openingRegime: "RANGE",
    openingMsvId: null,
    openingFeatureSetId: null,
    closingMsvId: null,
    closingFeatureSetId: null,
    closingRegime: null,
    frozenAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

describe("buildExitPlan + guardian rule provider (M4)", () => {
  const bars = Array.from({ length: 20 }, (_, index) =>
    makeBar(
      index,
      String(100 + index * 0.1),
      String(100 + index * 0.1 + 1),
      String(100 + index * 0.1 - 1),
    ),
  );

  it("returns null when ATR bars insufficient", () => {
    const lot = makeLot({ openedAt: new Date("2026-01-01T00:19:00.000Z") });
    const plan = buildExitPlan({
      lot,
      bars: bars.slice(0, 5),
      runConfig: DEFAULT_EXIT_RUN_CONFIG,
      evaluatedAt: "2026-01-01T00:19:00.000Z",
    });
    expect(plan).toBeNull();
  });

  it("builds ExitPlan when ATR is valid", () => {
    const lot = makeLot();
    const plan = buildExitPlan({
      lot,
      bars,
      runConfig: DEFAULT_EXIT_RUN_CONFIG,
      evaluatedAt: "2026-01-01T00:19:00.000Z",
    });
    expect(plan).not.toBeNull();
    expect(plan?.atrUsdt).toBeTruthy();
  });

  it("fails closed (null) for SHORT lots — LONG-only in M4", () => {
    const lot = makeLot({ positionSide: "SHORT" });
    const plan = buildExitPlan({
      lot,
      bars,
      runConfig: DEFAULT_EXIT_RUN_CONFIG,
      evaluatedAt: "2026-01-01T00:19:00.000Z",
    });
    expect(plan).toBeNull();
  });

  it("fails closed (null) for non-SPOT instruments", () => {
    const lot = makeLot({ instrumentKind: "PERP" });
    const plan = buildExitPlan({
      lot,
      bars,
      runConfig: DEFAULT_EXIT_RUN_CONFIG,
      evaluatedAt: "2026-01-01T00:19:00.000Z",
    });
    expect(plan).toBeNull();
  });

  it("emits SL < entry < TP for a valid LONG plan (no inverted risk)", () => {
    const lot = makeLot();
    const plan = buildExitPlan({
      lot,
      bars,
      runConfig: DEFAULT_EXIT_RUN_CONFIG,
      evaluatedAt: "2026-01-01T00:19:00.000Z",
    });
    expect(plan).not.toBeNull();
    expect(Number(plan!.stopLoss.price)).toBeLessThan(Number(lot.avgCost));
    expect(Number(plan!.takeProfit.price)).toBeGreaterThan(Number(lot.avgCost));
  });

  it("provider exits on stop loss hit", () => {
    const lot = makeLot();
    const plan = buildExitPlan({
      lot,
      bars,
      runConfig: DEFAULT_EXIT_RUN_CONFIG,
      evaluatedAt: "2026-01-01T00:19:00.000Z",
    });
    expect(plan).not.toBeNull();

    const trailingStateByLotId = new Map<string, ReturnType<typeof updateTrailingSessionState>>();
    trailingStateByLotId.set(
      lot.id,
      updateTrailingSessionState({
        plan: plan!,
        bars,
        lot,
        markPrice: plan!.stopLoss.price,
        evaluatedAt: "2026-01-01T00:19:00.000Z",
      }),
    );

    const provider = createSlTpGuardianRuleProvider({
      getExitPlan: (lotId) => (lotId === lot.id ? plan! : undefined),
      getTrailingState: (lotId) => trailingStateByLotId.get(lotId),
    });

    const result = decideGuardianAction({
      tradingPermission: "ALLOW_TRADING",
      allowedStrategyIds: ["mean_reversion_v0"],
      tradeStrategyId: "mean_reversion_v0",
      barsHeld: 5,
      maxHoldBars: 0,
      ruleProviders: [provider],
      ruleInput: {
        lot,
        trade: makeTrade(),
        tradingPermission: "ALLOW_TRADING",
        allowedStrategyIds: ["mean_reversion_v0"],
        regime: "RANGE",
        markPrice: plan!.stopLoss.price,
        barsHeld: 5,
        cycleId: "cycle-1",
        evaluatedAt: "2026-01-01T00:19:00.000Z",
      },
    });

    expect(result).toEqual({
      decision: "EXIT_FULL",
      reasonCode: exitReasonCodes.stopLossHit,
      ruleId: exitRuleIds.stopLoss,
    });
  });

  it("insufficient ATR yields HOLD via null provider outcome", () => {
    const lot = makeLot({ openedAt: new Date("2026-01-01T00:04:00.000Z") });
    const provider = createSlTpGuardianRuleProvider({
      getExitPlan: () => undefined,
      getTrailingState: () => undefined,
    });

    const result = decideGuardianAction({
      tradingPermission: "ALLOW_TRADING",
      allowedStrategyIds: ["mean_reversion_v0"],
      tradeStrategyId: "mean_reversion_v0",
      barsHeld: 2,
      maxHoldBars: 0,
      ruleProviders: [provider],
      ruleInput: {
        lot,
        trade: makeTrade(),
        tradingPermission: "ALLOW_TRADING",
        allowedStrategyIds: ["mean_reversion_v0"],
        regime: "RANGE",
        markPrice: "100",
        barsHeld: 2,
        cycleId: "cycle-1",
        evaluatedAt: "2026-01-01T00:04:00.000Z",
      },
    });

    expect(result.decision).toBe("HOLD");
  });
});
