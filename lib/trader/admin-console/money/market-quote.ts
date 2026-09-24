/** A market label follows its persisted pair; source fallback never changes denomination. */
export function selectMarketQuote(rows: readonly Record<string, unknown>[], base: "BTC" | "ETH") {
  const candidates = rows.filter((row) => row.base === base && typeof row.last === "string");
  const row =
    candidates.find((row) => row.source === "htx" && row.quote === "USDT") ??
    candidates.find(
      (row) => (row.source === "coinbase" || row.source === "kraken") && row.quote === "USD",
    );
  if (!row) return null;
  return { symbol: base, currency: row.quote as "USD" | "USDT", price: String(row.last) };
}
