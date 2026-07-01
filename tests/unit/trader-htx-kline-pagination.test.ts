import { describe, expect, it } from "vitest";

import { fetchPaginatedHtxKlines } from "@/lib/trader/connectors/htx/kline-pagination";
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

describe("fetchPaginatedHtxKlines (RI-P7)", () => {
  it("paginates backwards until target bar count is reached", async () => {
    const pages: HtxKlineRow[][] = [];
    let call = 0;

    const result = await fetchPaginatedHtxKlines({
      symbol: "btcusdt",
      period: "1min",
      targetBarCount: 2500,
      batchSize: 1000,
      fetchPage: async ({ from }) => {
        call += 1;
        if (from === undefined) {
          const batch = Array.from({ length: 1000 }, (_, index) =>
            kline(1_700_000_000 + index * 60),
          );
          pages.push(batch);
          return batch;
        }
        const batch = Array.from({ length: 1000 }, (_, index) => kline(from + index * 60));
        pages.push(batch);
        return batch;
      },
    });

    expect(call).toBeGreaterThanOrEqual(2);
    expect(result.rows).toHaveLength(2500);
    expect(result.rows[0]!.id).toBeLessThan(result.rows.at(-1)!.id);
  });

  it("stops when a page returns fewer rows than batch size", async () => {
    const result = await fetchPaginatedHtxKlines({
      symbol: "btcusdt",
      period: "1min",
      targetBarCount: 5000,
      batchSize: 2000,
      fetchPage: async () => [kline(100), kline(160)],
    });

    expect(result.rows).toHaveLength(2);
    expect(result.pageCount).toBe(1);
  });
});
