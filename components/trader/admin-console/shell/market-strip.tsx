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
      aria-label="Рынок сейчас"
      className="border-waia-divider flex flex-wrap items-center gap-x-7 gap-y-2 border-b px-4 py-3 text-xs lg:px-8"
    >
      <span className="text-waia-fg-muted text-[10px] font-medium tracking-widest uppercase">
        Рынок сейчас
      </span>
      {quoteProp ? (
        <span>{`${quoteProp.symbol}/${quoteProp.currency} ${formatAdminMoney(quoteProp.price, quoteProp.currency)}`}</span>
      ) : market?.quotes ? (
        market.quotes.map((quote) => (
          <div
            key={quote.symbol}
            className="flex flex-wrap items-baseline gap-2"
            title={`${quote.price.source ?? "Источник не установлен"} · ${quote.price.times.effectiveAt ?? "Время не установлено"}`}
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
                {quote.price.state === "stale" ? " · устарело" : ""}
              </span>
            ) : (
              <span className="text-waia-fg-muted">Нет котировки</span>
            )}
          </div>
        ))
      ) : (
        <DataState state="unavailable" reason={read.reason ?? "QUOTE_PENDING"} />
      )}
      {market?.fearGreed ? (
        <div
          className="flex items-baseline gap-2"
          title={`alternative.me · ${market.fearGreed.times.effectiveAt ?? "Время не установлено"}`}
        >
          <span className="text-waia-fg-muted">Страх и жадность</span>
          <span className="font-semibold tabular-nums">{market.fearGreed.value ?? "—"}</span>
          <span className="text-waia-fg-muted text-[10px]">
            {market.fearGreed.value === null
              ? "Нет данных"
              : market.fearGreed.state === "stale"
                ? "alternative.me · устарело"
                : "alternative.me"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
