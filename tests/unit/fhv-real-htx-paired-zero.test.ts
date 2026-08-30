import { describe, expect, it } from "vitest";

import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";
import {
  RealHtxPreflightError,
  assertHtxAmountBaseVolQuote,
  runRealHtxPreflight,
} from "@/lib/trader/market-data/fhv-real-htx-preflight";

function row(overrides: Partial<HtxKlineRow> = {}): HtxKlineRow {
  return {
    id: 1_685_579_280,
    open: 1_887.82,
    high: 1_887.82,
    low: 1_887.82,
    close: 1_887.82,
    amount: 0,
    vol: 0,
    count: 0,
    ...overrides,
  };
}

function expectBlocked(input: HtxKlineRow, code: string): void {
  try {
    assertHtxAmountBaseVolQuote(input);
    throw new Error("expected preflight blocker");
  } catch (error) {
    expect(error).toBeInstanceOf(RealHtxPreflightError);
    expect((error as RealHtxPreflightError).code).toBe(code);
  }
}

describe("REAL_HTX_PREFLIGHT strict paired-zero no-trade candles", () => {
  it("accepts the observed upstream no-trade shape", () => {
    expect(() => assertHtxAmountBaseVolQuote(row())).not.toThrow();
  });

  it.each([
    { overrides: { amount: 0, vol: 1 }, label: "zero base with positive quote" },
    { overrides: { amount: 1, vol: 0 }, label: "positive base with zero quote" },
  ])("blocks asymmetric zero: $label", ({ overrides }) => {
    expectBlocked(row(overrides), "AMOUNT_VOL_NON_POSITIVE");
  });

  it("blocks paired zero with a non-zero trade count", () => {
    expectBlocked(row({ count: 1 }), "ZERO_TRADE_COUNT_NON_ZERO");
  });

  it("blocks paired zero with non-flat OHLC", () => {
    expectBlocked(row({ high: 1_887.83 }), "ZERO_TRADE_OHLC_NOT_FLAT");
  });

  it.each([
    { overrides: { amount: Number.NaN }, code: "AMOUNT_VOL_NON_POSITIVE" },
    { overrides: { vol: Number.POSITIVE_INFINITY }, code: "AMOUNT_VOL_NON_POSITIVE" },
    { overrides: { close: Number.NaN }, code: "OHLC_NON_POSITIVE_OR_NON_FINITE" },
  ])("blocks non-finite provider fields", ({ overrides, code }) => {
    expectBlocked(row(overrides), code);
  });

  it("preserves the window and passes a page containing the exact observed candle", async () => {
    const calls: { from: number; to: number }[] = [];
    const result = await runRealHtxPreflight({
      symbols: ["ETHUSDT"],
      fetchPage: async (query) => {
        calls.push({ from: query.from, to: query.to });
        return [row({ id: query.from })];
      },
    });

    expect(result.classification).toBe("REAL_HTX_PREFLIGHT=PASS");
    expect(calls).toEqual([
      { from: 1_590_969_600, to: 1_590_973_199 },
      { from: 1_685_577_600, to: 1_685_581_199 },
      { from: 1_717_200_000, to: 1_717_203_599 },
    ]);
  });
});
