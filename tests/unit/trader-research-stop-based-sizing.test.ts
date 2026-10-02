import { describe, expect, it, vi } from "vitest";
import { applyCostToFill, COST_MODEL_VERSION_V1 } from "@/lib/trader/execution/cost-model";
import type { StrategySignal } from "@/lib/trader/intelligence/types";
import { defaultStopDistanceProvider } from "@/lib/trader/portfolio/default-stop-distance-provider";
import { computeResearchStopBasedQuantity, computeStopBasedQuantity } from "@/lib/trader/portfolio/stop-based-sizing";
import { addDecimal, compareDecimal, multiplyDecimal } from "@/lib/trader/risk/numeric";

type Input = Parameters<typeof computeResearchStopBasedQuantity>[0];
function fixture(): Input {
  return { side: "buy", symbol: "BTCUSDT", entryPrice: "100", defaultQuantity: "10",
    account: { equityUsdt: "10000", availableBalanceUsdt: "10000", openRiskUsdt: "0",
      openPositionCount: 0, positions: [] },
    limits: { maxRiskPerTradePct: "0.001", maxPortfolioRiskPct: "0.05",
      maxConcurrentPositions: 10, maxNotional: "100000" },
    runConfig: { startingBalanceUsdt: "10000", defaultStopDistancePct: "0.02", minOrderQty: "0.00001" },
    costModel: { version: COST_MODEL_VERSION_V1, feesBps: "20", slippageBps: "15" } };
}
const signal: StrategySignal = { strategySignalId: "legacy-signal", strategyId: "mean_reversion_v0",
  strategyVersion: "0", organizationId: "test-org", symbol: "BTCUSDT", outcome: "SIGNAL",
  side: "buy", reasonCodes: [], msvId: "msv", featureSetId: "features", evaluatedAt: "2026-01-01T00:00:00.000Z",
  maxRisk: "1" };

describe("research sizing shares arithmetic without claiming an MVP signal", () => {
  it("caps at risk divided by stop and leaves the declaration as an upper bound", () => {
    const input = fixture();
    expect(computeResearchStopBasedQuantity(input)).toEqual({ ok: true, quantity: "5",
      stopDistanceUsdt: "2", stopDistanceSource: "RUN_DEFAULT_PCT" });
    expect(computeResearchStopBasedQuantity({ ...input, defaultQuantity: "0.125" })).toMatchObject({ quantity: "0.125" });
  });
  it("retains remaining portfolio-risk and notional caps", () => {
    const input = fixture();
    expect(computeResearchStopBasedQuantity({ ...input,
      account: { ...input.account, openRiskUsdt: "499" } })).toMatchObject({ quantity: "0.5" });
    expect(computeResearchStopBasedQuantity({ ...input,
      limits: { ...input.limits, maxNotional: "25" } })).toMatchObject({ quantity: "0.25" });
    expect(computeResearchStopBasedQuantity({ ...input,
      account: { ...input.account, openRiskUsdt: "500" } })).toEqual({ ok: false, reason: "PORTFOLIO_BELOW_MIN_QTY" });
  });
  it("cannot spend more cash than available after actual modeled fees and slippage", () => {
    const input = fixture();
    input.account.availableBalanceUsdt = "50";
    const sized = computeResearchStopBasedQuantity(input);
    expect(sized.ok).toBe(true);
    if (!sized.ok) throw new Error("expected size");
    const cost = applyCostToFill(input.entryPrice, sized.quantity, "buy", input.costModel);
    expect(compareDecimal(addDecimal(multiplyDecimal(cost.adjustedPrice, sized.quantity), cost.fee), "50")).toBeLessThanOrEqual(0);
    expect(compareDecimal(sized.quantity, "0.5")).toBeLessThan(0);
  });
  it("does not open shorts and limits a sale to the actual position and declared cap", () => {
    const input = { ...fixture(), side: "sell" as const };
    expect(computeResearchStopBasedQuantity(input)).toEqual({ ok: false, reason: "SELL_NO_POSITION" });
    input.account.positions = [{ symbol: "BTCUSDT", quantity: "0.2", avgCost: "100", markPrice: "100",
      unrealizedPnlUsdt: "0", riskAtStopUsdt: "0.4", stopDistanceUsdt: "2" }];
    expect(computeResearchStopBasedQuantity(input)).toMatchObject({ quantity: "0.2" });
    expect(computeResearchStopBasedQuantity({ ...input, defaultQuantity: "0.1" })).toMatchObject({ quantity: "0.1" });
    expect(computeResearchStopBasedQuantity({ ...input, symbol: "ETHUSDT" })).toEqual({ ok: false, reason: "SELL_NO_POSITION" });
  });
  it.each(["0", "-0.01"])("refuses invalid default stop %s", defaultStopDistancePct => {
    const input = fixture();
    expect(computeResearchStopBasedQuantity({ ...input, runConfig: { ...input.runConfig, defaultStopDistancePct } }))
      .toEqual({ ok: false, reason: "RISK_INVALID_STOP_DISTANCE" });
  });
  it("research cannot acquire a custom provider or legacy cap through extra runtime properties", () => {
    const resolveStopDistance = vi.fn(() => ({ stopDistanceUsdt: "10000", source: "RUN_DEFAULT_PCT" }));
    const input = { ...fixture(), signal, legacyMaxRisk: "0.01", stopDistanceProvider: { resolveStopDistance } };
    expect(computeResearchStopBasedQuantity(input)).toMatchObject({ quantity: "5", stopDistanceUsdt: "2" });
    expect(resolveStopDistance).not.toHaveBeenCalled();
  });
  it("preserves legacy maxRisk while matching the existing V2 no-signal-cap arithmetic", () => {
    const input = fixture();
    const legacy = { ...input, signal, stopDistanceProvider: defaultStopDistanceProvider };
    expect(computeStopBasedQuantity(legacy)).toMatchObject({ quantity: "0.01" });
    expect(computeStopBasedQuantity({ ...legacy, capitalAuthorityPath: "v2" })).toEqual(computeResearchStopBasedQuantity(input));
  });
  it("retains legacy custom-provider and no-position error precedence", () => {
    const input = fixture();
    const resolveStopDistance = vi.fn(() => { throw new Error("missing provider data"); });
    const legacy = { ...input, signal, stopDistanceProvider: { resolveStopDistance } };
    expect(computeStopBasedQuantity({ ...legacy, side: "sell" })).toEqual({ ok: false, reason: "SELL_NO_POSITION" });
    expect(resolveStopDistance).not.toHaveBeenCalled();
    expect(computeStopBasedQuantity(legacy)).toEqual({ ok: false, reason: "RISK_INVALID_STOP_DISTANCE" });
    expect(resolveStopDistance).toHaveBeenCalledOnce();
  });
});
