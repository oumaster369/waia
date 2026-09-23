"use client";

import { DataState } from "@/components/trader/admin-console/primitives/data-state";

export function MarketStrip({
  quote,
}: {
  quote?: { symbol: "BTC" | "ETH"; currency: "USD" | "USDT"; price: string } | null;
}) {
  if (!quote) {
    return (
      <div>
        Рынок сейчас <DataState state="unavailable" reason="COLLECTORS_DISABLED" />
      </div>
    );
  }
  const pair = quote.currency === "USD" ? `${quote.symbol}/USD` : `${quote.symbol}/USDT`;
  return <p>{`Рынок сейчас ${pair} ${quote.price} ${quote.currency}`}</p>;
}
