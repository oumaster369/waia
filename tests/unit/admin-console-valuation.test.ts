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
  it("does not let an unrelated or confirmed-zero tiny-price asset invalidate cash", () => {
    const unrelated = { ...input().quotes[0]!, asset: "DUST", price: "0.000000001" };
    for (const balances of [
      [{ asset: "USDT", free: "600.02906483", locked: "0" }],
      [
        { asset: "USDT", free: "600.02906483", locked: "0" },
        { asset: "DUST", free: "0.000000000000", locked: "0" },
      ],
      [{ asset: "DUST", free: "0", locked: "0" }],
    ]) {
      const args = input({ balances, lots: [], quotes: [] });
      const baseline = valueObservation(args);
      const valued = valueObservation({ ...args, quotes: [unrelated] });
      expect(valued).toEqual(baseline);
      expect(valued.state).toBe("ok");
    }
  });

  it("still refuses unsupported precision of a quote needed by a held asset", () => {
    const valued = valueObservation(
      input({
        balances: [{ asset: "DUST", free: "1", locked: "0" }],
        lots: [],
        quotes: [{ ...input().quotes[0]!, asset: "DUST", price: "0.000000001" }],
      }),
    );
    expect(valued).toMatchObject({
      state: "unavailable",
      equity: null,
      reasons: ["MONEY_PRECISION_UNSUPPORTED"],
    });
  });

  it("does not parse an older quote after selecting the current quote for that asset", () => {
    const fresh = input().quotes[0]!;
    const old = { ...fresh, price: "0.000000001", observedAt: "2026-09-22T00:00:00Z" };
    const args = input({
      balances: [{ asset: "BTC", free: "1", locked: "0" }],
      lots: [],
      quotes: [fresh],
    });
    expect(valueObservation({ ...args, quotes: [old, fresh] })).toEqual(valueObservation(args));
  });

  it("uses a fresh USD fallback instead of a stale preferred source and preserves its provenance", () => {
    const stale = {
      asset: "USDT",
      source: "coinbase",
      quoteCurrency: "USD" as const,
      price: "2",
      sourceTs: new Date(now - 240000).toISOString(),
      observedAt: new Date(now).toISOString(),
    };
    const fresh = {
      ...stale,
      source: "kraken",
      price: "0.99",
      sourceTs: new Date(now).toISOString(),
    };
    for (const quotes of [
      [stale, fresh],
      [fresh, stale],
    ]) {
      expect(
        valueObservation(
          input({
            currency: "USD",
            balances: [{ asset: "USDT", free: "10", locked: "0" }],
            lots: [],
            quotes,
          }),
        ),
      ).toMatchObject({
        state: "ok",
        equity: "9.9",
        method: "usdt_usd:kraken",
        quoteSet: [fresh],
        reasons: [],
      });
    }
  });
  it("refuses a zero market quote and keeps excess Trader lots out of attributed PnL", () => {
    const zero = valueObservation(
      input({
        quotes: [
          {
            asset: "BTC",
            price: "0",
            source: "htx",
            sourceTs: new Date(now).toISOString(),
            observedAt: new Date(now).toISOString(),
          },
        ],
      }),
    );
    expect(zero.reasons).toContain("NO_QUOTE:BTC");
    expect(zero.traderUnrealized).toBeNull();
    const mismatch = valueObservation(
      input({ lots: [{ asset: "BTC", remainingQty: "2", avgCost: "90", accountMatched: true }] }),
    );
    expect(mismatch.traderUnrealized).toBeNull();
    expect(mismatch.externalValue).toBeNull();
    expect(mismatch.reasons).toContain("LOT_BALANCE_MISMATCH");
    expect(equityInclusion(mismatch.reasons, mismatch.equity).included).toBe(true);
  });
  it("preserves exact trailing zeroes without rounding unsupported precision or throwing", () => {
    expect(
      valueObservation(
        input({
          balances: [{ asset: "USDT", free: "10.000000000000", locked: "0" }],
          lots: [],
          quotes: [],
        }),
      ),
    ).toMatchObject({ equity: "10", state: "ok" });
    expect(
      valueObservation(
        input({
          balances: [{ asset: "USDT", free: "10.000000001", locked: "0" }],
          lots: [],
          quotes: [],
        }),
      ),
    ).toMatchObject({
      equity: null,
      state: "unavailable",
      reasons: ["MONEY_PRECISION_UNSUPPORTED"],
    });
  });
  it("does not let a USD venue overwrite an HTX/USDT valuation", () => {
    const htx = input().quotes[0]!;
    const coinbase = { ...htx, source: "coinbase", price: "999", quoteCurrency: "USD" as const };
    for (const quotes of [
      [htx, coinbase],
      [coinbase, htx],
    ]) {
      const value = valueObservation(
        input({ balances: [{ asset: "BTC", free: "1", locked: "0" }], lots: [], quotes }),
      );
      expect(value.equity).toBe("100");
      expect(value.method).toBe("htx_spot_last:usdt");
    }
  });

  it("includes FX value and time in the revision and applies age/skew to FX", () => {
    const fx = {
      ...input().quotes[0]!,
      asset: "USDT",
      source: "coinbase",
      quoteCurrency: "USD" as const,
      price: "1",
    };
    const args = input({
      currency: "USD",
      balances: [{ asset: "USDT", free: "10", locked: "0" }],
      lots: [],
      quotes: [fx],
    });
    const first = valueObservation(args);
    const next = valueObservation({ ...args, quotes: [{ ...fx, price: "0.9" }] });
    expect(next.equity).toBe("9");
    expect(next.valuationKey).not.toBe(first.valuationKey);
    const old = valueObservation({
      ...args,
      quotes: [{ ...fx, sourceTs: "2026-09-20T00:00:00Z" }],
    });
    expect(old.reasons).toEqual(expect.arrayContaining(["QUOTE_STALE", "VALUATION_SKEW"]));
    expect(old.valuationKey).not.toBe(first.valuationKey);
  });

  it("does not require a market quote for a confirmed zero holding", () => {
    const value = valueObservation(
      input({ balances: [{ asset: "USDC", free: "0", locked: "0.000" }], lots: [], quotes: [] }),
    );
    expect(value).toMatchObject({ equity: "0", state: "ok", reasons: [] });
  });

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
    expect(equityInclusion(["NO_QUOTE:BTC"], "10").included).toBe(true);
    expect(equityInclusion(["COST_BASIS_UNKNOWN"], null).included).toBe(false);
  });
});
