import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AlternativeMeFearGreedClient } from "@/lib/trader/connectors/alternative-me/fear-greed-client";
import { BinancePublicMarketClient } from "@/lib/trader/connectors/binance/public-market-client";
import { BybitPublicMarketClient } from "@/lib/trader/connectors/bybit/public-market-client";
import { CoinGeckoGlobalMarketClient } from "@/lib/trader/connectors/coingecko/global-market-client";
import {
  buildProvenanceRef,
  normalizeCrossExchangeConfirmation,
  normalizeFearGreedObservation,
  normalizeGlobalMarketObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";

function fixturePath(name: string): string {
  return path.join(process.cwd(), "tests/fixtures/trader", name);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("PR2.5 provider adapters", () => {
  it("normalizes Binance ticker into cross-exchange confirmation", async () => {
    const fixture = JSON.parse(
      readFileSync(fixturePath("binance-btcusdt-ticker.json"), "utf8"),
    ) as { symbol: string; price: string };

    const fetchImpl = (async (url: string) => {
      if (url.includes("ticker/price")) {
        return jsonResponse(fixture);
      }
      throw new Error(`unexpected url ${url}`);
    }) as typeof fetch;

    const client = new BinancePublicMarketClient({ fetchImpl });
    const ticker = await client.getTickerPrice("BTC/USDT");
    const evaluatedAt = "2026-01-01T14:00:00.000Z";

    const observation = normalizeCrossExchangeConfirmation({
      symbol: "BTC/USDT",
      primaryLast: "64000",
      confirmLast: ticker.price,
      confirmVenue: "binance",
      provenance: buildProvenanceRef({
        providerId: "binance_public",
        venue: "binance",
        feedKind: "cross_exchange_confirmation",
        symbol: "BTC/USDT",
        eventTimeUtc: evaluatedAt,
      }),
      latencyMs: 12,
      evaluatedAt,
    });

    expect(observation.kind).toBe("cross_exchange_confirmation");
    expect(observation.health).toBe("HEALTHY");
    expect(observation.payload.confirmLast).toBe("64005.12");
  });

  it("normalizes Bybit ticker into cross-exchange confirmation", async () => {
    const fixture = JSON.parse(readFileSync(fixturePath("bybit-btcusdt-ticker.json"), "utf8"));

    const fetchImpl = (async (url: string) => {
      if (url.includes("/v5/market/tickers")) {
        return jsonResponse(fixture);
      }
      throw new Error(`unexpected url ${url}`);
    }) as typeof fetch;

    const client = new BybitPublicMarketClient({ fetchImpl });
    const ticker = await client.getSpotTicker("BTC/USDT");
    const evaluatedAt = "2026-01-01T14:00:00.000Z";

    const observation = normalizeCrossExchangeConfirmation({
      symbol: "BTC/USDT",
      primaryLast: "64000",
      confirmLast: ticker.lastPrice,
      confirmVenue: "bybit",
      provenance: buildProvenanceRef({
        providerId: "bybit_public",
        venue: "bybit",
        feedKind: "cross_exchange_confirmation",
        symbol: "BTC/USDT",
        eventTimeUtc: evaluatedAt,
      }),
      latencyMs: 15,
      evaluatedAt,
    });

    expect(observation.kind).toBe("cross_exchange_confirmation");
    expect(observation.payload.confirmLast).toBe("63998.50");
  });

  it("normalizes Alternative.me fear and greed fixture", async () => {
    const fixture = JSON.parse(readFileSync(fixturePath("alternative-me-fear-greed.json"), "utf8"));

    const fetchImpl = (async (url: string) => {
      if (url.includes("/fng/")) {
        return jsonResponse(fixture);
      }
      throw new Error(`unexpected url ${url}`);
    }) as typeof fetch;

    const client = new AlternativeMeFearGreedClient({ fetchImpl });
    const point = await client.getLatest();
    const evaluatedAt = "2026-01-01T14:00:00.000Z";

    const observation = normalizeFearGreedObservation({
      value: Number(point.value),
      classification: point.value_classification,
      provenance: buildProvenanceRef({
        providerId: "alternative_me",
        venue: "alternative_me",
        feedKind: "fear_greed_index",
        symbol: "GLOBAL",
        eventTimeUtc: evaluatedAt,
      }),
      latencyMs: 20,
      evaluatedAt,
      eventTimeUtc: evaluatedAt,
    });

    expect(observation.kind).toBe("fear_greed_index");
    expect(observation.payload.value).toBe(52);
    expect(observation.payload.classification).toBe("Neutral");
  });

  it("normalizes CoinGecko global market fixture", async () => {
    const fixture = JSON.parse(readFileSync(fixturePath("coingecko-global.json"), "utf8"));

    const fetchImpl = (async (url: string) => {
      if (url.includes("/api/v3/global")) {
        return jsonResponse(fixture);
      }
      throw new Error(`unexpected url ${url}`);
    }) as typeof fetch;

    const client = new CoinGeckoGlobalMarketClient({ fetchImpl });
    const global = await client.getGlobalMarket();
    const evaluatedAt = "2026-01-01T14:00:00.000Z";

    const observation = normalizeGlobalMarketObservation({
      btcDominance: global.market_cap_percentage.btc ?? 0,
      marketCapUsd: global.total_market_cap.usd ?? 0,
      provenance: buildProvenanceRef({
        providerId: "coingecko_global",
        venue: "coingecko",
        feedKind: "global_market_stats",
        symbol: "GLOBAL",
        eventTimeUtc: evaluatedAt,
      }),
      latencyMs: 30,
      evaluatedAt,
      eventTimeUtc: evaluatedAt,
    });

    expect(observation.kind).toBe("global_market_stats");
    expect(observation.payload.btcDominance).toBe(54.2);
  });
});
