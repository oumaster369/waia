import type { AdminFact, AdminMoney } from "@/lib/trader/admin-console/contracts";
import { adminFact } from "@/lib/trader/admin-console/data-state";
import { compareDecimal } from "@/lib/trader/risk/numeric";

export type MarketRead = {
  quotes: { symbol: "BTC" | "ETH"; pair: string | null; price: AdminFact<AdminMoney> }[];
  fearGreed: AdminFact<number>;
};
function iso(value: unknown): string | null {
  const time =
    value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function validPrice(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) return false;
  try {
    return compareDecimal(value, "0") > 0;
  } catch {
    return false;
  }
}
export function presentMarket(
  rows: readonly Record<string, unknown>[],
  fear: Record<string, unknown> | undefined,
  nowMs: number,
): MarketRead {
  const quotes = (["BTC", "ETH"] as const).map((symbol) => {
    const candidates = rows.filter((row) => row.base === symbol && validPrice(row.last));
    const row =
      candidates.find((r) => r.source === "htx" && r.quote === "USDT") ??
      candidates.find(
        (r) => ["coinbase", "kraken"].includes(String(r.source)) && r.quote === "USD",
      );
    if (!row)
      return {
        symbol,
        pair: null,
        price: adminFact<AdminMoney>({ state: "unavailable", value: null, reasons: ["NO_QUOTE"] }),
      };
    const sourceAt = iso(row.source_ts);
    const observedAt = iso(row.observed_at);
    const effectiveAt = sourceAt ?? observedAt;
    const stale = !effectiveAt || nowMs - Date.parse(effectiveAt) > 180_000;
    return {
      symbol,
      pair: `${symbol}/${String(row.quote)}`,
      price: adminFact<AdminMoney>({
        state: stale ? "stale" : "ok",
        value: {
          amount: String(row.last),
          currency: String(row.quote),
          method: `${String(row.source)}_spot_last:${String(row.quote).toLowerCase()}`,
        },
        source: String(row.source),
        times: { sourceAt, observedAt, effectiveAt },
        reasons: stale ? ["QUOTE_STALE"] : [],
      }),
    };
  });
  const value = fear?.value;
  const sourceAt = iso(fear?.source_ts);
  const observedAt = iso(fear?.observed_at);
  const effectiveAt = sourceAt ?? observedAt;
  const valid = typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
  const stale = !effectiveAt || nowMs - Date.parse(effectiveAt) > 48 * 60 * 60 * 1000;
  return {
    quotes,
    fearGreed: adminFact({
      state: !valid ? "unavailable" : stale ? "stale" : "ok",
      value: valid ? value : null,
      source: valid ? "alternative.me" : null,
      times: { sourceAt, observedAt, effectiveAt },
      reasons: !valid ? ["FEAR_GREED_UNAVAILABLE"] : stale ? ["FEAR_GREED_STALE"] : [],
    }),
  };
}
