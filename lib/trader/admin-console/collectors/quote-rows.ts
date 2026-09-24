import { decimalText } from "@/lib/trader/admin-console/collectors/decimal-text";

export type HtxTickerFields = {
  symbol: string;
  open: string | number | null;
  high: string | number | null;
  low: string | number | null;
  close: string | number;
  vol: string | number | null;
  bid: string | number | null;
  ask: string | number | null;
};

export type QuoteLatestRow = {
  source: string;
  symbol: string;
  base: string;
  quote: string;
  last: string | null;
  bid: string | null;
  ask: string | null;
  open24h: string | null;
  high24h: string | null;
  low24h: string | null;
  volume24h: string | null;
  priceDefinition: "last" | "mid";
  sourceTs: string | null;
  observedAt: string;
};

export type QuoteMinuteRow = {
  source: string;
  symbol: string;
  minute: string;
  close: string;
  observedAt: string;
};

function minuteSymbols(): Set<string> {
  return new Set(["BTC-USD", "ETH-USD", "USDT-USD", "btcusdt", "ethusdt"]);
}

export function minuteBucket(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) throw new Error("QUOTE_TIME");
  return new Date(Math.floor(at / 60_000) * 60_000).toISOString();
}

export function htxQuoteRows(
  tickers: readonly HtxTickerFields[],
  input: { observedAt: string; sourceTs: string | null },
): { latest: QuoteLatestRow[]; minute: QuoteMinuteRow[] } {
  const latest: QuoteLatestRow[] = [];
  const minute: QuoteMinuteRow[] = [];
  const bucket = minuteBucket(input.observedAt);
  for (const ticker of tickers) {
    const symbol = ticker.symbol.trim().toLowerCase();
    if (!symbol.endsWith("usdt") || symbol === "usdt") continue;
    const last = decimalText(ticker.close);
    if (last === null) continue;
    const base = symbol.slice(0, -4).toUpperCase();
    if (base.length === 0) continue;
    latest.push({
      source: "htx",
      symbol,
      base,
      quote: "USDT",
      last,
      bid: decimalText(ticker.bid),
      ask: decimalText(ticker.ask),
      open24h: decimalText(ticker.open),
      high24h: decimalText(ticker.high),
      low24h: decimalText(ticker.low),
      volume24h: decimalText(ticker.vol),
      priceDefinition: "last",
      sourceTs: input.sourceTs,
      observedAt: input.observedAt,
    });
    if (minuteSymbols().has(symbol)) {
      minute.push({
        source: "htx",
        symbol,
        minute: bucket,
        close: last,
        observedAt: input.observedAt,
      });
    }
  }
  return { latest, minute };
}

export type UsdQuoteProduct = {
  symbol: "BTC-USD" | "ETH-USD" | "USDT-USD";
  last: string | number | null;
  bid?: string | number | null;
  ask?: string | number | null;
  open24h?: string | number | null;
  high24h?: string | number | null;
  low24h?: string | number | null;
  volume24h?: string | number | null;
  sourceTs?: string | null;
};

export function usdQuoteRows(input: {
  source: "coinbase" | "kraken";
  observedAt: string;
  products: readonly UsdQuoteProduct[];
}): { latest: QuoteLatestRow[]; minute: QuoteMinuteRow[] } {
  const latest: QuoteLatestRow[] = [];
  const minute: QuoteMinuteRow[] = [];
  const bucket = minuteBucket(input.observedAt);
  for (const product of input.products) {
    const last = decimalText(product.last);
    if (last === null) continue;
    const [base, quote] = product.symbol.split("-");
    if (!base || !quote) continue;
    latest.push({
      source: input.source,
      symbol: product.symbol,
      base,
      quote,
      last,
      bid: decimalText(product.bid),
      ask: decimalText(product.ask),
      open24h: decimalText(product.open24h),
      high24h: decimalText(product.high24h),
      low24h: decimalText(product.low24h),
      volume24h: decimalText(product.volume24h),
      priceDefinition: "last",
      sourceTs: product.sourceTs ?? null,
      observedAt: input.observedAt,
    });
    minute.push({
      source: input.source,
      symbol: product.symbol,
      minute: bucket,
      close: last,
      observedAt: input.observedAt,
    });
  }
  return { latest, minute };
}
