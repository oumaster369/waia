import { HTX_DEFAULT_REST_HOST } from "@/lib/trader/connectors/htx/config";
import { decimalText } from "@/lib/trader/admin-console/collectors/decimal-text";

export type HtxPublicTicker = {
  symbol: string;
  open: number | string | null;
  high: number | string | null;
  low: number | string | null;
  close: number | string;
  amount: number | string | null;
  vol: number | string | null;
  bid: number | string | null;
  ask: number | string | null;
};

function numberLike(value: unknown): value is number | string {
  return (typeof value === "number" || typeof value === "string") && decimalText(value) !== null;
}

function parseTickers(body: unknown): HtxPublicTicker[] {
  if (!body || typeof body !== "object") throw new Error("HTX_TICKERS_BODY");
  const record = body as Record<string, unknown>;
  if (record.status !== "ok") throw new Error("HTX_TICKERS_STATUS");
  if (!Array.isArray(record.data)) throw new Error("HTX_TICKERS_BODY");
  return record.data.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const ticker = row as Record<string, unknown>;
    if (typeof ticker.symbol !== "string" || !numberLike(ticker.close)) return [];
    return [
      {
        symbol: ticker.symbol,
        open: numberLike(ticker.open) ? ticker.open : null,
        high: numberLike(ticker.high) ? ticker.high : null,
        low: numberLike(ticker.low) ? ticker.low : null,
        close: ticker.close,
        amount: numberLike(ticker.amount) ? ticker.amount : null,
        vol: numberLike(ticker.vol) ? ticker.vol : null,
        bid: numberLike(ticker.bid) ? ticker.bid : null,
        ask: numberLike(ticker.ask) ? ticker.ask : null,
      },
    ];
  });
}

export async function fetchHtxPublicTickers(
  fetchImpl: typeof fetch = fetch,
  host = HTX_DEFAULT_REST_HOST,
): Promise<HtxPublicTicker[]> {
  return (await fetchHtxPublicTickerSnapshot(fetchImpl, host)).tickers;
}

export async function fetchHtxPublicTickerSnapshot(
  fetchImpl: typeof fetch = fetch,
  host = HTX_DEFAULT_REST_HOST,
): Promise<{ tickers: HtxPublicTicker[]; sourceTs: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetchImpl(`${host}/market/tickers`, { signal: controller.signal });
    if (!response.ok) throw new Error("HTX_TICKERS_HTTP");
    const body: unknown = await response.json();
    const tickers = parseTickers(body);
    const timestamp = (body as { ts?: unknown }).ts;
    const sourceTs =
      typeof timestamp === "number" &&
      Number.isFinite(timestamp) &&
      !Number.isNaN(new Date(timestamp).getTime())
        ? new Date(timestamp).toISOString()
        : null;
    return { tickers, sourceTs };
  } finally {
    clearTimeout(timer);
  }
}
