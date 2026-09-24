import { createHash } from "node:crypto";

import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

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
