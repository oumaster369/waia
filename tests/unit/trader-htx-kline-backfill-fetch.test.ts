import { describe, expect, it } from "vitest";

import { fetchHtxKlineBars } from "../../scripts/trader/htx-kline-backfill";
import { HTX_ENDPOINTS } from "@/lib/trader/connectors/htx/config";
import type { HtxKlineResponse } from "@/lib/trader/connectors/htx/types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeKlineResponse(ids: number[]): HtxKlineResponse {
  return {
    status: "ok",
    ch: "market.btcusdt.kline.1min",
    ts: Date.now(),
    data: ids.map((id) => ({
      id,
      open: 1,
      close: 2,
      low: 0.5,
      high: 2.5,
      amount: 10,
      vol: 10,
      count: 5,
    })),
  };
}

describe("fetchHtxKlineBars candles pagination wiring", () => {
  it("uses candles endpoint for paginated backfill", async () => {
    const requestedPaths: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      requestedPaths.push(url.pathname);
      const from = url.searchParams.get("from");
      const start = from ? Number.parseInt(from, 10) : 1_700_000_000;
      const ids = Array.from({ length: 1000 }, (_, index) => start + index * 60);
      return jsonResponse(makeKlineResponse(ids));
    }) as typeof fetch;

    const bars = await fetchHtxKlineBars(
      {
        organizationId: "00000000-0000-4000-8000-0000000272",
        internalSymbol: "BTC/USDT",
        period: "1min",
        size: 2000,
        targetBarCount: 2500,
      },
      { fetchImpl },
    );

    expect(requestedPaths.every((path) => path.endsWith(HTX_ENDPOINTS.marketHistoryCandles))).toBe(
      true,
    );
    expect(bars).toHaveLength(2500);
  });

  it("uses kline endpoint for small single-shot backfill", async () => {
    let requestedPath = "";

    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      requestedPath = url.pathname;
      const ids = Array.from({ length: 100 }, (_, index) => 1_700_000_000 + index * 60);
      return jsonResponse(makeKlineResponse(ids));
    }) as typeof fetch;

    const bars = await fetchHtxKlineBars(
      {
        organizationId: "00000000-0000-4000-8000-0000000272",
        internalSymbol: "BTC/USDT",
        period: "1min",
        size: 2000,
        targetBarCount: 100,
      },
      { fetchImpl },
    );

    expect(requestedPath.endsWith(HTX_ENDPOINTS.marketHistoryKline)).toBe(true);
    expect(bars).toHaveLength(100);
  });
});
