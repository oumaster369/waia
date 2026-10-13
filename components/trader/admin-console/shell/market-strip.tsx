"use client";
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import { formatAdminMoney } from "@/components/trader/admin-console/primitives/money";
import type { MarketRead } from "@/lib/trader/admin-console/read-models/market";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
import { EvidenceTime } from "@/components/trader/admin-console/primitives/console-ui";
type MarketQuote = { symbol: "BTC" | "ETH"; currency: "USD" | "USDT"; price: string };
export function MarketStrip({ quote: quoteProp }: { quote?: MarketQuote | null }) {
  const read = useAdminRead<MarketRead>(quoteProp ? null : "/api/trader/admin/console/market", {
    context: false,
    intervalMs: 30_000,
  });
  const market = read.envelope?.data;
  return (
    <div
      aria-label="Market now"
      className="border-waia-divider flex flex-wrap items-center gap-x-7 gap-y-2 border-b px-4 py-3 text-xs lg:px-8"
    >
      <span className="text-waia-fg-muted text-[10px] font-medium tracking-widest uppercase">
        Market now
      </span>
      {quoteProp ? (
        <span>{`${quoteProp.symbol}/${quoteProp.currency} ${formatAdminMoney(quoteProp.price, quoteProp.currency)}`}</span>
      ) : market?.quotes ? (
        market.quotes.map((quote) => (
          <div
            key={quote.symbol}
            className="flex flex-wrap items-baseline gap-2"
            title={`${quote.price.source ?? "Source not established"} · ${quote.price.times.effectiveAt ?? "Time not established"}`}
          >
            <span className="font-medium">{quote.pair ?? quote.symbol}</span>
            <span className="font-semibold tabular-nums">
              {quote.price.value
                ? formatAdminMoney(quote.price.value.amount, quote.price.value.currency)
                : "—"}
            </span>
            {quote.price.value ? (
              <span className="text-waia-fg-muted text-[10px]">
                {quote.price.source} · <EvidenceTime at={quote.price.times.effectiveAt} label="" />
                {quote.price.state === "stale" ? "· stale" : ""}
              </span>
            ) : (
              <span className="text-waia-fg-muted">No quote</span>
            )}
          </div>
        ))
      ) : (
        <DataState state="unavailable" reason={read.reason ?? "QUOTE_PENDING"} />
      )}
      {market?.fearGreed ? (
        <div
          className="flex items-baseline gap-2"
          title={`alternative.me · ${market.fearGreed.times.effectiveAt ?? "Time not established"}`}
        >
          <span className="text-waia-fg-muted">Fear and greed</span>
          <span className="font-semibold tabular-nums">{market.fearGreed.value ?? "—"}</span>
          <span className="text-waia-fg-muted text-[10px]">
            {market.fearGreed.value === null
              ? "No data"
              : market.fearGreed.state === "stale"
                ? "alternative.me · stale"
                : "alternative.me"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
