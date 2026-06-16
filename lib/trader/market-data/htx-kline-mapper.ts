import { internalSymbolToHtx } from "@/lib/trader/connectors/htx/mappers";
import type { HtxKlineRow, HtxMarketMergedResponse } from "@/lib/trader/connectors/htx/types";
import {
  BTC_USDT,
  type Bar,
  type BarInterval,
  type InstrumentId,
  type Quote,
} from "@/lib/trader/intelligence/types";

const ONE_MINUTE_MS = 60_000;
const DEFAULT_INTERVAL: BarInterval = "1m";

function formatDecimal(value: number): string {
  return value.toFixed(8).replace(/\.?0+$/, "") || "0";
}

function barTimesFromOpenSeconds(openSeconds: number): {
  barOpenTime: string;
  barCloseTime: string;
} {
  const barOpenTime = new Date(openSeconds * 1000).toISOString();
  const barCloseTime = new Date(openSeconds * 1000 + ONE_MINUTE_MS).toISOString();
  return { barOpenTime, barCloseTime };
}

export function mapHtxKlinesToBars(
  internalSymbol: InstrumentId,
  klines: readonly HtxKlineRow[],
): Bar[] {
  const sorted = [...klines].sort((left, right) => left.id - right.id);

  return sorted.map((row) => {
    const { barOpenTime, barCloseTime } = barTimesFromOpenSeconds(row.id);
    const volume = row.amount ?? row.vol;

    return {
      symbol: internalSymbol,
      interval: DEFAULT_INTERVAL,
      open: formatDecimal(row.open),
      high: formatDecimal(row.high),
      low: formatDecimal(row.low),
      close: formatDecimal(row.close),
      volume: formatDecimal(volume),
      barOpenTime,
      barCloseTime,
    };
  });
}

export function mapHtxMergedToQuote(
  internalSymbol: InstrumentId,
  merged: HtxMarketMergedResponse,
): Quote {
  const tick = merged.tick ?? {};
  const close = tick.close ?? tick.bid?.[0] ?? tick.ask?.[0] ?? 0;
  const bid = tick.bid?.[0] ?? close;
  const ask = tick.ask?.[0] ?? close;
  const timestamp = merged.ts ? new Date(merged.ts).toISOString() : new Date().toISOString();

  return {
    symbol: internalSymbol,
    bid: formatDecimal(bid),
    ask: formatDecimal(ask),
    last: formatDecimal(close),
    timestamp,
  };
}

/** HTX wire symbol for the MVP BTC/USDT slice. */
export function btcUsdtHtxWireSymbol(): string {
  return internalSymbolToHtx(BTC_USDT);
}
