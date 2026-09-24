"use client";

import * as React from "react";

import { DataState } from "@/components/trader/admin-console/primitives/data-state";

type MarketQuote = { symbol: "BTC" | "ETH"; currency: "USD" | "USDT"; price: string };

export function MarketStrip({ quote: quoteProp }: { quote?: MarketQuote | null }) {
  const [loaded, setLoaded] = React.useState<MarketQuote | null>(null);
  React.useEffect(() => {
    if (quoteProp) return;
    const controller = new AbortController();
    void fetch("/api/trader/admin/console/overview", { signal: controller.signal })
      .then((response) => response.json())
      .then((body: unknown) => {
        const data =
          body && typeof body === "object" && "data" in body
            ? (body as { data?: { market?: MarketQuote | null } }).data
            : null;
        const market = data?.market;
        if (market && (market.symbol === "BTC" || market.symbol === "ETH") && market.price) {
          setLoaded(market);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [quoteProp]);
  const quote = quoteProp ?? loaded;
  if (!quote) {
    return (
      <div>
        Рынок сейчас <DataState state="unavailable" reason="QUOTE_PENDING" />
      </div>
    );
  }
  const pair = quote.currency === "USD" ? `${quote.symbol}/USD` : `${quote.symbol}/USDT`;
  return <p>{`Рынок сейчас ${pair} ${quote.price} ${quote.currency}`}</p>;
}
