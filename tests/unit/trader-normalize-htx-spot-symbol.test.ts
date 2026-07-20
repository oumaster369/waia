import { describe, expect, it } from "vitest";

import {
  normalizeHtxSpotSymbol,
  TRADER_WORKSPACE_SUPPORTED_HTX_SPOT_PAIR_MESSAGE,
  UNSUPPORTED_HTX_SPOT_SYMBOL_MESSAGE,
} from "@/lib/trader/symbols/normalize-htx-spot-symbol";

describe("normalizeHtxSpotSymbol", () => {
  it("normalizes HTX wire symbols to canonical internal format", () => {
    expect(normalizeHtxSpotSymbol("btcusdt")).toEqual({ ok: true, symbol: "BTC/USDT" });
    expect(normalizeHtxSpotSymbol("ethusdt")).toEqual({ ok: true, symbol: "ETH/USDT" });
  });

  it("normalizes slash symbols regardless of case and whitespace", () => {
    expect(normalizeHtxSpotSymbol("eth/usdt")).toEqual({ ok: true, symbol: "ETH/USDT" });
    expect(normalizeHtxSpotSymbol("  BTC/USDT  ")).toEqual({ ok: true, symbol: "BTC/USDT" });
    expect(normalizeHtxSpotSymbol("ETH/USDT")).toEqual({ ok: true, symbol: "ETH/USDT" });
  });

  it("rejects unsupported symbols safely", () => {
    expect(normalizeHtxSpotSymbol("solusdt")).toEqual({
      ok: false,
      message: UNSUPPORTED_HTX_SPOT_SYMBOL_MESSAGE,
    });
    expect(normalizeHtxSpotSymbol("SOL/USDT")).toEqual({
      ok: false,
      message: UNSUPPORTED_HTX_SPOT_SYMBOL_MESSAGE,
    });
  });

  it("rejects empty input", () => {
    expect(normalizeHtxSpotSymbol("   ")).toEqual({
      ok: false,
      message: TRADER_WORKSPACE_SUPPORTED_HTX_SPOT_PAIR_MESSAGE,
    });
  });
});
