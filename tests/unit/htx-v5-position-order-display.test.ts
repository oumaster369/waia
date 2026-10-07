import { describe, expect, it } from "vitest";
import { htxV5PositionOrderDisplay } from "@/lib/trader/account-observation/htx-v5-position-order-display";
import type { HtxV5AccountObservation } from "@/lib/trader/account-observation/types";
import type { HtxV5AlgoOrder, HtxV5Position } from "@/lib/trader/account-observation/derivatives/htx-v5-read-contract";
import { ACCOUNT_OBSERVATION_STALE_AFTER_MS } from "@/lib/trader/account-observation/cabinet-view";

const now = 1_800_000_000_000;
const position: HtxV5Position = {
  contractCode: "ETH-USDT", positionSide: "long", direction: "buy", marginMode: "isolated",
  volume: "2", available: "2", openAveragePrice: "2670", liquidationPrice: null,
  initialMargin: null, maintenanceMargin: "0", margin: "10", profitUnreal: "1",
  profitRate: "0.01", marginRate: "0.1", marginCurrency: "USDT", lastPrice: "2675",
  markPrice: "2674", contractType: "swap", createdTimeMs: now - 100, updatedTimeMs: now,
};
const order: HtxV5AlgoOrder = {
  id: "11", algoId: "11", contractCode: "ETH-USDT", volume: "1", type: "tpsl",
  state: "active", positionSide: "long", side: "sell", marginMode: "isolated",
  tpTriggerPrice: "2790", slTriggerPrice: "2610", reduceOnly: null,
  createdTimeMs: now - 100, updatedTimeMs: now,
};
function projection(orders: readonly HtxV5AlgoOrder[] = [order], row = position): Pick<HtxV5AccountObservation, "positions" | "algoOrders"> {
  const times = { readStartedAtMs: now - 20, readCompletedAtMs: now, responseGeneratedAtMs: now, error: null };
  return {
    positions: { ...times, status: "COMPLETE", values: [row], pageScope: null },
    algoOrders: { ...times, status: "PARTIAL", values: orders,
      pageScope: { pageSize: 100, maxPagesPerType: 1, queries: [], completeness: "UNKNOWN" } },
  };
}

describe("HTX received conditional orders beside positions", () => {
  it("shows the exact received prices and volume without claiming protection or coverage", () => {
    const result = htxV5PositionOrderDisplay({ position, projection: projection(), stale: false, nowMs: now });
    expect(result).toEqual({ status: "CURRENT", stops: [order], targets: [order], protection: "UNCONFIRMED" });
    // One observed contract of stop volume must not silently protect a two-contract position.
    expect(result.stops[0]!.volume).toBe("1");
  });

  it.each([
    { contractCode: "BTC-USDT" }, { positionSide: "short" as const },
    { marginMode: "cross" as const }, { side: "buy" as const },
    { volume: "0" }, { volume: "-1" }, { volume: "0e10" },
    { type: "trigger" as const }, { type: "trailing_stop" as const },
  ])("does not associate another position or unsupported/empty order: %j", patch => {
    const result = htxV5PositionOrderDisplay({ position, projection: projection([{ ...order, ...patch }]), stale: false, nowMs: now });
    expect(result.stops).toEqual([]);
    expect(result.targets).toEqual([]);
    expect(result.protection).toBe("UNCONFIRMED");
  });

  it("handles long and short closing directions separately", () => {
    const short = { ...position, positionSide: "short" as const, direction: "sell" as const };
    const closeShort = { ...order, positionSide: "short" as const, side: "buy" as const };
    const result = htxV5PositionOrderDisplay({ position: short, projection: projection([order, closeShort], short), stale: false, nowMs: now });
    expect(result.stops).toEqual([closeShort]);
    const invalid = { ...short, direction: "buy" as const };
    expect(htxV5PositionOrderDisplay({ position: invalid, projection: projection([closeShort], invalid), stale: false, nowMs: now }).status).toBe("UNAVAILABLE");
  });

  it("requires reduce-only evidence for one-way orders", () => {
    const oneWay = { ...position, positionSide: "both" as const };
    for (const reduceOnly of [null, false, true]) {
      const conditional = { ...order, positionSide: "both" as const, reduceOnly };
      const result = htxV5PositionOrderDisplay({ position: oneWay, projection: projection([conditional], oneWay), stale: false, nowMs: now });
      expect(result.stops).toEqual(reduceOnly === true ? [conditional] : []);
      expect(result.protection).toBe("UNCONFIRMED");
    }
  });

  it("does not mistake a take-profit-only combined order or absent trigger for a stop", () => {
    for (const slTriggerPrice of [null, "0", "0e5", "-2610", "NaN", "Infinity"]) {
      const result = htxV5PositionOrderDisplay({ position, projection: projection([{ ...order, slTriggerPrice }]), stale: false, nowMs: now });
      expect(result.stops).toEqual([]);
      expect(result.targets).toHaveLength(1);
    }
    const tiny = { ...order, type: "sl" as const, slTriggerPrice: "1e-400", volume: "1e-400" };
    expect(htxV5PositionOrderDisplay({ position, projection: projection([tiny]), stale: false, nowMs: now }).stops).toEqual([tiny]);
  });

  it("never links stale, failed, future-dated or untimed reads to a current position", () => {
    expect(htxV5PositionOrderDisplay({ position, projection: projection(), stale: true, nowMs: now }).status).toBe("STALE");
    expect(htxV5PositionOrderDisplay({ position, projection: projection(), stale: false, nowMs: now + ACCOUNT_OBSERVATION_STALE_AFTER_MS }).status).toBe("STALE");
    for (const section of ["positions", "algoOrders"] as const) {
      for (const patch of [
        { status: "ERROR" as const }, { error: "READ_FAILED" as const }, { values: null },
        { readCompletedAtMs: null }, { readCompletedAtMs: now + 1 },
      ]) {
        const source = projection();
        const changed = { ...source, [section]: { ...source[section], ...patch } };
        expect(htxV5PositionOrderDisplay({ position, projection: changed, stale: false, nowMs: now })).toEqual({
          status: "UNAVAILABLE", stops: [], targets: [], protection: "UNCONFIRMED",
        });
      }
    }
  });

  it("keeps a missing or empty order list distinct from proof of no stop", () => {
    expect(htxV5PositionOrderDisplay({ position, projection: projection([]), stale: false, nowMs: now })).toEqual({
      status: "CURRENT", stops: [], targets: [], protection: "UNCONFIRMED",
    });
    const zero = { ...position, volume: "0" };
    expect(htxV5PositionOrderDisplay({ position: zero, projection: projection([order], zero), stale: false, nowMs: now }).status).toBe("UNAVAILABLE");
  });

  it("requires the actual unique position row from the same snapshot", () => {
    const source = projection();
    for (const rows of [[], [position, { ...position }], [{ ...position }]]) {
      const unbound = { ...source, positions: { ...source.positions, values: rows } };
      expect(htxV5PositionOrderDisplay({ position, projection: unbound, stale: false, nowMs: now })).toEqual({
        status: "UNAVAILABLE", stops: [], targets: [], protection: "UNCONFIRMED",
      });
    }
    expect(htxV5PositionOrderDisplay({ position: { ...position, volume: "99" }, projection: source, stale: false, nowMs: now }).status).toBe("UNAVAILABLE");
  });
});
