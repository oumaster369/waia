import { describe, expect, it } from "vitest";

import {
  equityInclusion,
  valueObservation,
  type ValuationInput,
} from "@/lib/trader/admin-console/money/valuation";
import { compareDecimal } from "@/lib/trader/risk/numeric";

const now = Date.parse("2026-09-23T12:00:00.000Z");

function input(overrides: Partial<ValuationInput> = {}): ValuationInput {
  return {
    observationId: "obs-1",
    recordedAt: "2026-09-23T11:59:00.000Z",
    balances: [
      { asset: "USDT", free: "100", locked: "25" },
      { asset: "BTC", free: "1", locked: "0.5" },
      { asset: "USDC", free: "40", locked: "0" },
    ],
    lots: [{ asset: "BTC", remainingQty: "1", avgCost: "90", accountMatched: true }],
    lotsRevision: "lots-1",
    quotes: [
      {
        asset: "BTC",
        price: "100",
        source: "htx",
        sourceTs: "2026-09-23T11:59:30.000Z",
        observedAt: "2026-09-23T11:59:30.000Z",
      },
    ],
    currency: "USDT",
    nowMs: now,
    ...overrides,
  };
}

describe("admin console valuation", () => {
  it("prices locked BTC, excludes an unquoted stablecoin, and splits trader lots", () => {
    const value = valueObservation(input());
    expect(value.state).toBe("partial");
    expect(value.reasons).toContain("NO_QUOTE:USDC");
    expect(value.freeQuote).toBe("100");
    expect(value.lockedQuote).toBe("25");
    expect(value.holdingsValue).toBe("150");
    expect(compareDecimal(value.equity ?? "0", "275")).toBe(0);
    expect(value.traderLotsValue).toBe("100");
    expect(value.traderCostBasis).toBe("90");
    expect(value.traderUnrealized).toBe("10");
    expect(value.externalValue).toBeNull();
  });

  it("does not invent a USD amount without a Coinbase USDT-USD quote", () => {
    const value = valueObservation(input({ currency: "USD" }));
    expect(value.state).toBe("unavailable");
    expect(value.equity).toBeNull();
    expect(value.reasons).toContain("NO_QUOTE:USDT-USD");
  });

  it("converts to USD only through USDT-USD", () => {
    const value = valueObservation(
      input({
        currency: "USD",
        balances: [{ asset: "USDT", free: "10", locked: "0" }],
        lots: [],
        quotes: [
          {
            asset: "USDT",
            price: "0.99",
            source: "coinbase",
            sourceTs: "2026-09-23T11:59:30.000Z",
            observedAt: "2026-09-23T11:59:30.000Z",
          },
        ],
      }),
    );
    expect(value.equity).toBe("9.9");
    expect(value.method).toBe("usdt_usd:coinbase");
  });

  it("keeps the same valuation key for the same inputs and changes it for a new observation", () => {
    const first = valueObservation(input());
    const second = valueObservation(input());
    expect(first.valuationKey).toBe(second.valuationKey);
    const next = valueObservation(input({ observationId: "obs-2" }));
    expect(next.valuationKey).not.toBe(first.valuationKey);
  });

  it("marks a stale quote and a skewed quote", () => {
    const stale = valueObservation(
      input({
        balances: [{ asset: "BTC", free: "1", locked: "0" }],
        lots: [],
        quotes: [
          {
            asset: "BTC",
            price: "100",
            source: "htx",
            sourceTs: "2026-09-23T11:50:00.000Z",
            observedAt: "2026-09-23T11:50:00.000Z",
          },
        ],
      }),
    );
    expect(stale.reasons).toContain("QUOTE_STALE");
    expect(stale.reasons).toContain("VALUATION_SKEW");
    expect(stale.equity).toBe("100");
  });

  it("does not invent unrealized PnL when a lot cannot be matched", () => {
    const value = valueObservation(
      input({
        balances: [{ asset: "USDT", free: "1", locked: "0" }],
        lots: [{ asset: "BTC", remainingQty: "1", avgCost: "1", accountMatched: false }],
        quotes: [],
      }),
    );
    expect(value.traderUnrealized).toBeNull();
    expect(value.reasons).toContain("COST_BASIS_UNKNOWN");
  });

  it("keeps confirmed equity when only the lot match is missing", () => {
    expect(equityInclusion(["COST_BASIS_UNKNOWN"], "10")).toEqual({
      included: true,
      stale: false,
    });
    expect(equityInclusion(["QUOTE_STALE"], "10")).toEqual({ included: true, stale: true });
    expect(equityInclusion(["NO_QUOTE:BTC"], "10").included).toBe(false);
    expect(equityInclusion(["COST_BASIS_UNKNOWN"], null).included).toBe(false);
  });
});
