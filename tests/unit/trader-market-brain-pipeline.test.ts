import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { HTX_ENDPOINTS } from "@/lib/trader/connectors/htx/config";
import type { HtxKlineResponse, HtxMarketMergedResponse } from "@/lib/trader/connectors/htx/types";
import { BTC_USDT, ETH_USDT } from "@/lib/trader/intelligence/types";
import { runHtxIngestionCycle } from "@/lib/trader/market-brain/htx-ingestion";
import { CANONICAL_MARKET_QUESTION_IDS } from "@/lib/trader/intelligence/market-understanding.types";
import { runMarketBrainPipeline } from "@/lib/trader/market-brain/market-brain-pipeline";
import { buildReplayFusedContext } from "@/lib/trader/market-data/replay-fused-context-builder";
import {
  DATA_QUALITY_HALT_REASON,
  INGESTION_HALT_REASON,
} from "@/lib/trader/market-data/data-quality-gate";
import type { Bar, Quote } from "@/lib/trader/intelligence/types";

type HtxKlineFixture = {
  kline: HtxKlineResponse;
  merged: HtxMarketMergedResponse;
};

function loadMeanReversionFixture(): { bars: Bar[]; latestQuote: Quote } {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as { bars: Bar[]; latestQuote: Quote };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createMockFetch(fixture: HtxKlineFixture, ethSymbol = "ethusdt") {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    if (url.pathname.endsWith(HTX_ENDPOINTS.marketHistoryKline)) {
      return jsonResponse(fixture.kline);
    }
    if (url.pathname.endsWith(HTX_ENDPOINTS.marketDetailMerged)) {
      return jsonResponse(fixture.merged);
    }
    if (url.searchParams.get("symbol") === ethSymbol) {
      return jsonResponse(fixture.kline);
    }
    throw new Error(`Unexpected fetch: ${url.toString()}`);
  }) as typeof fetch;
}

describe("market brain pipeline (P3 DEE-197–202)", () => {
  it("produces understanding when fusedContext is supplied", () => {
    const fixture = loadMeanReversionFixture();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const fusedContext = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });

    const result = runMarketBrainPipeline({
      organizationId: "org-p3",
      instrumentId: BTC_USDT,
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      fusedContext,
      newId: () => "p3-test-id",
    });

    expect(result.halted).toBe(false);
    expect(result.understanding).toBeDefined();
    expect(result.understanding!.questionEvaluations).toHaveLength(11);
    expect(result.understanding!.questionEvaluations.map((q) => q.questionId).sort()).toEqual(
      [...CANONICAL_MARKET_QUESTION_IDS].sort(),
    );
    expect(result.msv?.understanding?.spotPosture).toBe(result.understanding!.spotPosture);
  });

  it("runs full intelligence path on good fixture data", () => {
    const fixture = loadMeanReversionFixture();
    const result = runMarketBrainPipeline({
      organizationId: "org-p3",
      instrumentId: BTC_USDT,
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt: fixture.bars.at(-1)!.barCloseTime,
      newId: () => "p3-test-id",
    });

    expect(result.halted).toBe(false);
    expect(result.msv).not.toBeNull();
    expect(result.signal).not.toBeNull();
    expect(result.msv!.derived.tradingPermission).toBe("ALLOW_TRADING");
  });

  it("halts fail-closed on ingestion error", () => {
    const result = runMarketBrainPipeline({
      organizationId: "org-p3",
      instrumentId: ETH_USDT,
      bars: [],
      ingestionError: "htx unavailable",
    });
    expect(result.halted).toBe(true);
    expect(result.haltReasonCode).toBe(INGESTION_HALT_REASON);
    expect(result.signal).toBeNull();
  });

  it("halts fail-closed on low data quality", () => {
    const result = runMarketBrainPipeline({
      organizationId: "org-p3",
      instrumentId: BTC_USDT,
      bars: [
        {
          symbol: BTC_USDT,
          interval: "1m",
          open: "1",
          high: "1",
          low: "1",
          close: "1",
          volume: "1",
          barOpenTime: "2026-01-01T00:00:00.000Z",
          barCloseTime: "2026-01-01T00:00:59.999Z",
        },
      ],
    });
    expect(result.halted).toBe(true);
    expect(result.haltReasonCode).toBe(DATA_QUALITY_HALT_REASON);
    expect(result.signal).toBeNull();
  });
});

describe("htx ingestion cycle (DEE-197)", () => {
  function loadHtxFixture(): HtxKlineFixture {
    const filePath = path.join(process.cwd(), "tests/fixtures/trader/htx-kline-btcusdt-1m.json");
    return JSON.parse(readFileSync(filePath, "utf8")) as HtxKlineFixture;
  }

  it("polls BTC and ETH in deterministic order", async () => {
    const fixture = loadHtxFixture();
    const fetchImpl = createMockFetch(fixture);
    const result = await runHtxIngestionCycle({ fetchImpl });

    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.instrumentId).toBe(BTC_USDT);
    expect(result.results[1]!.instrumentId).toBe(ETH_USDT);
    expect(result.allSucceeded).toBe(true);
    expect(result.results[0]!.snapshot?.bars.length).toBeGreaterThanOrEqual(20);
  });

  it("records ingestion errors without throwing", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const result = await runHtxIngestionCycle({ fetchImpl, symbols: [BTC_USDT] });
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0]!.ingestionError).toContain("network down");
  });
});
