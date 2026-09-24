import { HTX_DEFAULT_REST_HOST } from "@/lib/trader/connectors/htx/config";

export type HtxPublicTicker = {
  symbol: string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  amount: number | string;
  vol: number | string;
  bid: number | string;
  ask: number | string;
};

function numberLike(value: unknown): value is number | string {
  return typeof value === "number" || typeof value === "string";
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
        open: numberLike(ticker.open) ? ticker.open : ticker.close,
        high: numberLike(ticker.high) ? ticker.high : ticker.close,
        low: numberLike(ticker.low) ? ticker.low : ticker.close,
        close: ticker.close,
        amount: numberLike(ticker.amount) ? ticker.amount : "0",
        vol: numberLike(ticker.vol) ? ticker.vol : "0",
        bid: numberLike(ticker.bid) ? ticker.bid : ticker.close,
        ask: numberLike(ticker.ask) ? ticker.ask : ticker.close,
      },
    ];
  });
}

export async function fetchHtxPublicTickers(
  fetchImpl: typeof fetch = fetch,
  host = HTX_DEFAULT_REST_HOST,
): Promise<HtxPublicTicker[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetchImpl(`${host}/market/tickers`, { signal: controller.signal });
    if (!response.ok) throw new Error("HTX_TICKERS_HTTP");
    return parseTickers(await response.json());
  } finally {
    clearTimeout(timer);
  }
}
