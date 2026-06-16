import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { HtxKlineRow, HtxMarketMergedResponse } from "@/lib/trader/connectors/htx/types";
import { BTC_USDT } from "@/lib/trader/intelligence/types";
import {
  btcUsdtHtxWireSymbol,
  mapHtxKlinesToBars,
  mapHtxMergedToQuote,
} from "@/lib/trader/market-data/htx-kline-mapper";

type HtxKlineFixture = {
  kline: { data: HtxKlineRow[] };
  merged: HtxMarketMergedResponse;
};

function loadFixture(): HtxKlineFixture {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/htx-kline-btcusdt-1m.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as HtxKlineFixture;
}

describe("htx kline mapper (AT-E3 S4)", () => {
  it("btcUsdtHtxWireSymbol returns btcusdt", () => {
    expect(btcUsdtHtxWireSymbol()).toBe("btcusdt");
  });

  it("maps HTX klines to ascending intelligence bars with BTC/USDT symbol", () => {
    const fixture = loadFixture();
    const bars = mapHtxKlinesToBars(BTC_USDT, fixture.kline.data);

    expect(bars).toHaveLength(25);
    expect(bars[0]!.symbol).toBe("BTC/USDT");
    expect(bars[0]!.interval).toBe("1m");
    expect(Date.parse(bars[1]!.barOpenTime)).toBeGreaterThan(Date.parse(bars[0]!.barOpenTime));
    expect(bars.at(-1)!.close).toBe("64000");
  });

  it("sorts newest-first HTX rows into chronological order", () => {
    const rows: HtxKlineRow[] = [
      {
        id: 100,
        open: 2,
        high: 2,
        low: 2,
        close: 2,
        amount: 1,
        vol: 1,
        count: 1,
      },
      {
        id: 40,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        amount: 1,
        vol: 1,
        count: 1,
      },
    ];

    const bars = mapHtxKlinesToBars(BTC_USDT, rows);
    expect(bars[0]!.barOpenTime).toBe(new Date(40 * 1000).toISOString());
    expect(bars[1]!.barOpenTime).toBe(new Date(100 * 1000).toISOString());
  });

  it("maps merged tick to intelligence quote", () => {
    const fixture = loadFixture();
    const quote = mapHtxMergedToQuote(BTC_USDT, fixture.merged);

    expect(quote.symbol).toBe("BTC/USDT");
    expect(quote.last).toBe("64000");
    expect(quote.bid).toBe("63999.5");
    expect(quote.ask).toBe("64000.5");
    expect(quote.timestamp).toBe(new Date(fixture.merged.ts!).toISOString());
  });
});
