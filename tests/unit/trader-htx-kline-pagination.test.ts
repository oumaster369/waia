import { describe, expect, it } from "vitest";

import {
  computeHtxCandlesStartFromSeconds,
  fetchPaginatedHtxKlines,
  htxPeriodToSeconds,
} from "@/lib/trader/connectors/htx/kline-pagination";
import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";

function kline(id: number): HtxKlineRow {
  return {
    id,
    open: 1,
    close: 2,
    low: 0.5,
    high: 2.5,
    amount: 10,
    vol: 10,
    count: 5,
  };
}

describe("fetchPaginatedHtxKlines (RI-P7 candles forward paging)", () => {
  it("paginates forward until target bar count is reached", async () => {
    let call = 0;

    const result = await fetchPaginatedHtxKlines({
      symbol: "btcusdt",
      period: "1min",
      targetBarCount: 2500,
      batchSize: 1000,
      startFromSeconds: 1_700_000_000,
      fetchPage: async ({ from, size }) => {
        call += 1;
        const batch = Array.from({ length: size }, (_, index) => kline(from + index * 60));
        return batch;
      },
    });

    expect(call).toBeGreaterThanOrEqual(3);
    expect(result.rows).toHaveLength(2500);
    expect(result.rows[0]!.id).toBeLessThan(result.rows.at(-1)!.id);
    expect(result.rows[0]!.id).toBe(1_700_000_000);
  });

  it("stops when a page returns fewer rows than batch size", async () => {
    const result = await fetchPaginatedHtxKlines({
      symbol: "btcusdt",
      period: "1min",
      targetBarCount: 5000,
      batchSize: 2000,
      startFromSeconds: 100,
      fetchPage: async () => [kline(100), kline(160)],
    });

    expect(result.rows).toHaveLength(2);
    expect(result.pageCount).toBe(1);
  });

  it("stops when maxId does not advance (REST kline-style stall)", async () => {
    const latestWindow = Array.from({ length: 1000 }, (_, index) =>
      kline(1_782_000_000 + index * 60),
    );
    let call = 0;

    const result = await fetchPaginatedHtxKlines({
      symbol: "btcusdt",
      period: "1min",
      targetBarCount: 5000,
      batchSize: 1000,
      startFromSeconds: 1_700_000_000,
      fetchPage: async () => {
        call += 1;
        return latestWindow;
      },
    });

    expect(call).toBe(2);
    expect(result.rows).toHaveLength(1000);
  });

  it("deduplicates overlapping forward windows", async () => {
    const result = await fetchPaginatedHtxKlines({
      symbol: "btcusdt",
      period: "1min",
      targetBarCount: 1500,
      batchSize: 1000,
      startFromSeconds: 1_000,
      fetchPage: async ({ from, size }) => {
        if (from === 1_000) {
          return Array.from({ length: size }, (_, index) => kline(1_000 + index * 60));
        }
        return Array.from({ length: size }, (_, index) => kline(1_000 + (500 + index) * 60));
      },
    });

    expect(result.rows).toHaveLength(1500);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(1500);
  });
});

describe("htxPeriodToSeconds", () => {
  it("resolves 1min period", () => {
    expect(htxPeriodToSeconds("1min")).toBe(60);
  });
});

describe("computeHtxCandlesStartFromSeconds", () => {
  it("subtracts target bar span from now", () => {
    const start = computeHtxCandlesStartFromSeconds({
      targetBarCount: 100,
      period: "1min",
      nowSeconds: 1_000_000,
    });
    expect(start).toBe(1_000_000 - 100 * 60);
  });
});
