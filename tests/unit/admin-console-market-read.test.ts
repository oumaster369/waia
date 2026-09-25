import { describe, expect, it } from "vitest";
import { presentMarket } from "@/lib/trader/admin-console/read-models/market";
const now = Date.parse("2026-09-25T00:00:00Z");
describe("persisted admin market read", () => {
  it("keeps confirmed fear/greed zero, exact quote decimals, source and denomination", () => {
    const read = presentMarket(
      [
        {
          base: "BTC",
          quote: "USDT",
          source: "htx",
          last: "9007199254740993.00000001",
          observed_at: new Date(now),
          source_ts: new Date(now - 10_000),
        },
      ],
      { value: 0, source_ts: new Date(now) },
      now,
    );
    expect(read.fearGreed).toMatchObject({ state: "ok", value: 0, source: "alternative.me" });
    expect(read.quotes[0]).toMatchObject({
      pair: "BTC/USDT",
      price: {
        state: "ok",
        value: { amount: "9007199254740993.00000001", currency: "USDT" },
        source: "htx",
      },
    });
    expect(read.quotes[1].price).toMatchObject({
      state: "unavailable",
      value: null,
      reasons: ["NO_QUOTE"],
    });
  });
  it("retains stale quotes with their timestamp and never supplies a neutral fear/greed default", () => {
    const read = presentMarket(
      [
        {
          base: "ETH",
          quote: "USD",
          source: "coinbase",
          last: "123.45",
          source_ts: new Date(now - 181_000),
          observed_at: new Date(now),
        },
      ],
      undefined,
      now,
    );
    expect(read.quotes[1]).toMatchObject({
      pair: "ETH/USD",
      price: {
        state: "stale",
        reasons: ["QUOTE_STALE"],
        value: { amount: "123.45" },
        times: { sourceAt: new Date(now - 181_000).toISOString() },
      },
    });
    expect(read.fearGreed).toMatchObject({ state: "unavailable", value: null });
  });
});
