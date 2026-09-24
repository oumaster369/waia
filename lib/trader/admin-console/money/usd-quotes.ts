import { usdQuoteRows } from "@/lib/trader/admin-console/collectors/quote-rows";

const PRODUCTS = ["BTC-USD", "ETH-USD", "USDT-USD"] as const;
type UsdSymbol = (typeof PRODUCTS)[number];

const KRAKEN_PAIRS: Record<string, UsdSymbol> = {
  XXBTZUSD: "BTC-USD",
  XBTUSD: "BTC-USD",
  XETHZUSD: "ETH-USD",
  ETHUSD: "ETH-USD",
  USDTZUSD: "USDT-USD",
};

export async function fetchUsdQuoteRows(
  fetchImpl: typeof fetch = fetch,
  observedAt = new Date().toISOString(),
) {
  try {
    const products = await Promise.all(
      PRODUCTS.map((symbol) => coinbaseProduct(fetchImpl, symbol)),
    );
    return { ...usdQuoteRows({ source: "coinbase", observedAt, products }), source: "coinbase" };
  } catch {
    const products = await krakenProducts(fetchImpl);
    return { ...usdQuoteRows({ source: "kraken", observedAt, products }), source: "kraken" };
  }
}

async function coinbaseProduct(fetchImpl: typeof fetch, symbol: UsdSymbol) {
  const [ticker, stats] = await Promise.all([
    getJson(fetchImpl, `https://api.exchange.coinbase.com/products/${symbol}/ticker`),
    getJson(fetchImpl, `https://api.exchange.coinbase.com/products/${symbol}/stats`),
  ]);
  const last = textField(ticker, "price");
  if (last === null) throw new Error("COINBASE_PRICE_MISSING");
  return {
    symbol,
    last,
    bid: textField(ticker, "bid"),
    ask: textField(ticker, "ask"),
    open24h: textField(stats, "open"),
    high24h: textField(stats, "high"),
    low24h: textField(stats, "low"),
    volume24h: textField(stats, "volume") ?? textField(ticker, "volume"),
    sourceTs: textField(ticker, "time"),
  };
}

async function krakenProducts(fetchImpl: typeof fetch) {
  const body = await getJson(
    fetchImpl,
    "https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,USDTZUSD",
  );
  const errors = body.error;
  if (Array.isArray(errors) && errors.length > 0) throw new Error("KRAKEN_TICKER_ERROR");
  const result = body.result;
  if (!result || typeof result !== "object") throw new Error("KRAKEN_TICKER_EMPTY");
  const products = [];
  for (const [pair, row] of Object.entries(result)) {
    const symbol = KRAKEN_PAIRS[pair];
    if (!symbol || !row || typeof row !== "object") continue;
    const ticker = row as Record<string, unknown>;
    const last = pairField(ticker.c);
    if (last === null) continue;
    products.push({
      symbol,
      last,
      bid: pairField(ticker.b),
      ask: pairField(ticker.a),
      open24h: typeof ticker.o === "string" ? ticker.o : null,
      high24h: pairField(ticker.h, 1),
      low24h: pairField(ticker.l, 1),
      volume24h: pairField(ticker.v, 1),
      sourceTs: null,
    });
  }
  if (products.length === 0) throw new Error("KRAKEN_TICKER_EMPTY");
  return products;
}

async function getJson(fetchImpl: typeof fetch, url: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error("USD_QUOTE_HTTP");
    const body = (await response.json()) as unknown;
    if (!body || typeof body !== "object") throw new Error("USD_QUOTE_BODY");
    return body as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

function textField(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function pairField(value: unknown, index = 0): string | null {
  if (!Array.isArray(value)) return null;
  const entry = value[index];
  return typeof entry === "string" && entry.trim() !== "" ? entry : null;
}
