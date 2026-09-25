import { createHash } from "node:crypto";

import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { isPositiveDecimal } from "@/lib/trader/risk/numeric";

export const VALUATION_METHOD_VERSION = "htx_spot_last:usdt";
export const USD_METHOD_VERSION = "usdt_usd:coinbase";
export const QUOTE_STALE_AFTER_MS = 180_000;
export const VALUATION_SKEW_AFTER_MS = 300_000;

export type AssetQuote = {
  asset: string;
  price: string;
  source: string;
  sourceTs: string | null;
  observedAt: string;
  quoteCurrency?: "USDT" | "USD";
};

export function quoteAgeMs(quote: AssetQuote, nowMs: number): number | null {
  const stamp = quote.sourceTs ?? quote.observedAt;
  const at = Date.parse(stamp);
  if (!Number.isFinite(at)) return null;
  return nowMs - at;
}

export function quoteIsStale(quote: AssetQuote, nowMs: number): boolean {
  const age = quoteAgeMs(quote, nowMs);
  return age === null || age < 0 || age > QUOTE_STALE_AFTER_MS;
}

/** Share the same persisted FX selection between balances and period results. */
export function selectUsdQuote(
  quotes: readonly AssetQuote[],
  nowMs: number,
): AssetQuote | undefined {
  const candidates = quotes.filter((quote) => {
    if (
      quote.asset.toUpperCase() !== "USDT" ||
      (quote.quoteCurrency ?? "USD") !== "USD" ||
      !["coinbase", "kraken"].includes(quote.source)
    )
      return false;
    try {
      return isPositiveDecimal(quote.price);
    } catch {
      return false;
    }
  });
  return candidates.sort(
    (a, b) =>
      (quoteIsStale(a, nowMs) ? 1 : 0) - (quoteIsStale(b, nowMs) ? 1 : 0) ||
      (a.source === "coinbase" ? 0 : 1) - (b.source === "coinbase" ? 0 : 1) ||
      b.observedAt.localeCompare(a.observedAt) ||
      a.price.localeCompare(b.price),
  )[0];
}

export function quoteSetDigest(quotes: readonly AssetQuote[]): string {
  const body = quotes
    .map((quote) => ({
      asset: quote.asset.toUpperCase(),
      source: quote.source,
      price: quote.price,
      sourceTs: quote.sourceTs,
      observedAt: quote.observedAt,
      quoteCurrency: quote.quoteCurrency ?? (quote.source === "htx" ? "USDT" : "USD"),
    }))
    .sort((left, right) => left.asset.localeCompare(right.asset));
  return createHash("sha256").update(canonicalizeSemanticJsonString(body)).digest("hex");
}

export function valuationKey(input: {
  observationId: string;
  lotsRevision: string;
  quoteSetDigest: string;
  methodVersion?: string;
}): string {
  return createHash("sha256")
    .update(
      canonicalizeSemanticJsonString({
        observationId: input.observationId,
        lotsRevision: input.lotsRevision,
        quoteSetDigest: input.quoteSetDigest,
        methodVersion: input.methodVersion ?? VALUATION_METHOD_VERSION,
      }),
    )
    .digest("hex");
}
