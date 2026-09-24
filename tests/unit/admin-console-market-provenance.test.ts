import { describe, expect, it, vi } from "vitest";
import { fetchHtxPublicTickerSnapshot } from "@/lib/trader/admin-console/money/htx-public-tickers";
import { selectMarketQuote } from "@/lib/trader/admin-console/money/market-quote";
import { htxQuoteRows } from "@/lib/trader/admin-console/collectors/quote-rows";

describe("persisted market provenance", () => {
  it("retains USD on a fallback and chooses HTX USDT when present", () => {
    const usd = { base: "BTC", quote: "USD", source: "coinbase", last: "100" };
    const usdt = { base: "BTC", quote: "USDT", source: "htx", last: "99" };
    expect(selectMarketQuote([usd], "BTC")).toEqual({
      symbol: "BTC",
      currency: "USD",
      price: "100",
    });
    expect(selectMarketQuote([usd, usdt], "BTC")).toEqual({
      symbol: "BTC",
      currency: "USDT",
      price: "99",
    });
    expect(selectMarketQuote([{ ...usd, quote: "EUR" }], "BTC")).toBeNull();
  });

  it("does not manufacture OHLC, bid, ask or volume from a last price", async () => {
    const ts = Date.parse("2026-09-24T20:00:00Z");
    const fetcher = vi.fn(async () =>
      Response.json({
        status: "ok",
        ts,
        data: [
          { symbol: "btcusdt", close: "100" },
          { symbol: "ethusdt", close: "bad" },
        ],
      }),
    );
    const snapshot = await fetchHtxPublicTickerSnapshot(fetcher);
    expect(snapshot.sourceTs).toBe("2026-09-24T20:00:00.000Z");
    const rows = htxQuoteRows(snapshot.tickers, {
      sourceTs: snapshot.sourceTs,
      observedAt: snapshot.sourceTs!,
    });
    expect(rows.latest).toHaveLength(1);
    expect(rows.latest[0]).toMatchObject({
      last: "100",
      open24h: null,
      high24h: null,
      low24h: null,
      bid: null,
      ask: null,
      volume24h: null,
      sourceTs: snapshot.sourceTs,
    });
  });
});
