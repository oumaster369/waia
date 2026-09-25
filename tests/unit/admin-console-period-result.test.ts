import { describe, expect, it } from "vitest";
import {
  periodResult,
  type EquityEvidencePoint,
} from "@/lib/trader/admin-console/money/period-result";
import { operationalRealizedPnl } from "@/lib/trader/admin-console/money/operational-pnl";
import {
  periodSeries,
  aggregatePeriodSeries,
} from "@/lib/trader/admin-console/money/period-series";

const start = "2026-09-24T00:00:00.000Z";
const end = "2026-09-24T01:00:00.000Z";
const point = (at: string, equity: string, unrealized: string): EquityEvidencePoint => ({
  at,
  equity,
  unrealized,
  state: "ok",
  valuationKey: at,
});
const open = {
  kind: "OPEN" as const,
  executedAt: "2026-09-24T00:20:00.000Z",
  legPnl: "0",
  fee: "1",
  feeAsset: "USDT",
  price: "100",
  baseAsset: "BTC",
  quoteAsset: "USDT",
};
describe("period evidence", () => {
  it("builds absolute drawdown from trading results, not account funding, and keeps gaps", () => {
    const points = [
      point(start, "100", "0"),
      point("2026-09-24T00:30:00.000Z", "200", "10"),
      point(end, "400", "5"),
    ];
    const series = periodSeries({ points, legs: [], start, end, reasons: [] });
    expect(series.map((p) => [p.equity, p.pnl, p.drawdown])).toEqual([
      ["100", "0", "0"],
      ["200", "10", "0"],
      ["400", "5", "-5"],
    ]);
    const aggregate = aggregatePeriodSeries(
      [{ series }, { series: [series[0]!, series[2]!] }],
      "minute",
    );
    expect(aggregate[1]).toMatchObject({ included: 1, total: 2, pnl: null, drawdown: null });
    expect(aggregate[2]).toMatchObject({ equity: "800", pnl: "10" });
  });
  it("returns an explicit state for unsupported money precision", () => {
    expect(operationalRealizedPnl([{ ...open, fee: "0.000000001" }], start, end)).toMatchObject({
      state: "unavailable",
      realized: null,
      reasons: ["MONEY_PRECISION_UNSUPPORTED"],
    });
    expect(operationalRealizedPnl([{ ...open, fee: "1.000000000000" }], start, end).realized).toBe(
      "-1",
    );
  });
  it("adds delta unrealized to net realized and does not subtract closing fees again", () => {
    const result = periodResult({
      start,
      end,
      legs: [open, { ...open, kind: "CLOSE", legPnl: "8", fee: "2" }],
      points: [point(start, "1000", "4"), point(end, "2000", "7")],
    });
    expect(result).toMatchObject({
      state: "ok",
      total: "10",
      realized: "7",
      unrealizedChange: "3",
      openFees: "1",
      closeFees: "2",
      tradingFees: "3",
    });
    // The increase of account equity by 1000 is deliberately irrelevant.
    expect(result.total).not.toBe("1000");
  });
  it("keeps a known zero distinct from a missing boundary", () => {
    expect(
      periodResult({
        start,
        end,
        legs: [],
        points: [point(start, "0", "0"), point(end, "0", "0")],
      }),
    ).toMatchObject({ state: "ok", total: "0" });
    expect(periodResult({ start, end, legs: [], points: [] })).toMatchObject({
      state: "unavailable",
      total: null,
      realized: "0",
      reasons: ["UNREALIZED_HISTORY_MISSING"],
    });
  });
  it("labels the actual short history and never turns unmatched legs into a full result", () => {
    const points = [point("2026-09-24T00:30:00.000Z", "100", "2"), point(end, "100", "3")];
    expect(periodResult({ start, end, legs: [], points })).toMatchObject({
      state: "partial",
      total: "1",
      reasons: ["UNREALIZED_HISTORY_STARTS_AT:2026-09-24T00:30:00.000Z"],
    });
    expect(periodResult({ start, end, legs: [], points, reasons: ["UNATTRIBUTED"] })).toMatchObject(
      { state: "unavailable", total: null, realized: null },
    );
  });
  it("refuses a non-quote closing fee whose stored net denomination is unproven", () => {
    expect(
      operationalRealizedPnl(
        [{ ...open, kind: "CLOSE", fee: "0.01", feeAsset: "BTC", legPnl: "9.99" }],
        start,
        end,
      ),
    ).toMatchObject({ realized: null, reasons: ["CLOSE_FEE_DENOMINATION_UNVERIFIED"] });
    expect(operationalRealizedPnl([{ ...open, fee: "0", feeAsset: "" }], start, end)).toMatchObject(
      { realized: "0", tradingFees: "0" },
    );
  });
  it("does not combine a closing fill with an older unrealized endpoint", () => {
    const saved = [point(start, "100", "10"), point("2026-09-24T00:59:00.000Z", "100", "10")];
    const legs = [
      { ...open, kind: "CLOSE" as const, executedAt: "2026-09-24T00:59:30.000Z", legPnl: "9" },
    ];
    expect(periodResult({ start, end, legs, points: saved })).toMatchObject({
      state: "unavailable",
      total: null,
      realized: "9",
      reasons: ["UNREALIZED_HISTORY_ENDS_AT:2026-09-24T00:59:00.000Z"],
    });
    expect(
      periodResult({ start, end, legs, points: saved, currentEndpoint: point(end, "109", "0") }),
    ).toMatchObject({ state: "ok", total: "-1", realized: "9", unrealizedChange: "-10" });
    expect(
      periodResult({ start, end, legs, points: [], currentEndpoint: point(end, "109", "0") }),
    ).toMatchObject({ state: "unavailable", total: null, reasons: ["UNREALIZED_HISTORY_MISSING"] });
  });
});
