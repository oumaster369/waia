import { internalSymbolToHtx } from "@/lib/trader/connectors/htx/mappers";
import type { HtxKlineRow, HtxMarketMergedResponse } from "@/lib/trader/connectors/htx/types";
import {
  BTC_USDT,
  type Bar,
  type BarInterval,
  type InstrumentId,
  type Quote,
} from "@/lib/trader/intelligence/types";
import { intervalDurationMs } from "@/lib/trader/market-data/mtf/mtf-bar-aggregator";
import { HTX_MAPPED_VOLUME_AUTHORITY } from "@/lib/trader/market-data/volume-qualification/htx-volume-authority-capital-v1";

function formatDecimal(value: number): string {
  return value.toFixed(8).replace(/\.?0+$/, "") || "0";
}

function barTimesFromOpenSeconds(
  openSeconds: number,
  interval: BarInterval,
): {
  barOpenTime: string;
  barCloseTime: string;
} {
  const durationMs = intervalDurationMs(interval);
  const barOpenTime = new Date(openSeconds * 1000).toISOString();
  const barCloseTime = new Date(openSeconds * 1000 + durationMs).toISOString();
  return { barOpenTime, barCloseTime };
}

/**
 * Raw HTX → Bar ingestion for provenance/display.
 *
 * Canonical HTX spot kline semantics (DEE-526 repair):
 * - `amount` = traded BASE-ASSET quantity → `Bar.volume`
 * - `vol` = traded QUOTE-CURRENCY turnover (not mapped onto Bar.volume)
 *
 * `Bar.volume` remains NON_AUTHORITATIVE_RAW_INGESTION. Capital/capacity paths MUST
 * call `resolveAuthoritativeHtxBaseVolumeForCapital` with a QUALIFIED v2 receipt.
 */
export function mapHtxKlinesToBars(
  internalSymbol: InstrumentId,
  klines: readonly HtxKlineRow[],
  interval: BarInterval = "1m",
): Bar[] {
  void HTX_MAPPED_VOLUME_AUTHORITY;
  const sorted = [...klines].sort((left, right) => left.id - right.id);

  return sorted.map((row) => {
    const { barOpenTime, barCloseTime } = barTimesFromOpenSeconds(row.id, interval);
    const baseQuantity = Number.isFinite(row.amount) ? row.amount : 0;

    return {
      symbol: internalSymbol,
      interval,
      open: formatDecimal(row.open),
      high: formatDecimal(row.high),
      low: formatDecimal(row.low),
      close: formatDecimal(row.close),
      volume: formatDecimal(baseQuantity),
      barOpenTime,
      barCloseTime,
    };
  });
}

/** Explicit non-authority marker for callers that must not confuse raw bars with QUALIFIED volume. */
export function htxMappedVolumeAuthorityStatus(): typeof HTX_MAPPED_VOLUME_AUTHORITY {
  return HTX_MAPPED_VOLUME_AUTHORITY;
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
