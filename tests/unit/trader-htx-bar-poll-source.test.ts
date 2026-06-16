import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { HTX_ENDPOINTS } from "@/lib/trader/connectors/htx/config";
import type { HtxKlineResponse, HtxMarketMergedResponse } from "@/lib/trader/connectors/htx/types";
import { HtxBarPollSource } from "@/lib/trader/market-data/htx-bar-poll-source";

type HtxKlineFixture = {
  kline: HtxKlineResponse;
  merged: HtxMarketMergedResponse;
};

function loadFixture(): HtxKlineFixture {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/htx-kline-btcusdt-1m.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as HtxKlineFixture;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createMockFetch(fixture: HtxKlineFixture) {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    if (url.pathname.endsWith(HTX_ENDPOINTS.marketHistoryKline)) {
      return jsonResponse(fixture.kline);
    }
    if (url.pathname.endsWith(HTX_ENDPOINTS.marketDetailMerged)) {
      return jsonResponse(fixture.merged);
    }
    throw new Error(`Unexpected fetch: ${url.toString()}`);
  }) as typeof fetch;
}

describe("HtxBarPollSource (AT-E3 S4)", () => {
  it("fetchSnapshot returns 25 ascending bars and increments cycleId", async () => {
    const fixture = loadFixture();
    const poll = new HtxBarPollSource({
      fetchImpl: createMockFetch(fixture),
      cycleIdPrefix: "test-htx-poll",
    });

    const first = await poll.fetchSnapshot();
    const second = await poll.fetchSnapshot();

    expect(first.bars).toHaveLength(25);
    expect(first.bars[0]!.symbol).toBe("BTC/USDT");
    expect(first.quote.symbol).toBe("BTC/USDT");
    expect(first.cycleIndex).toBe(0);
    expect(first.cycleId).toBe("test-htx-poll-0");
    expect(second.cycleId).toBe("test-htx-poll-1");
  });

  it("uses neutral default cycleIdPrefix when not overridden", async () => {
    const fixture = loadFixture();
    const poll = new HtxBarPollSource({ fetchImpl: createMockFetch(fixture) });
    const snapshot = await poll.fetchSnapshot();
    expect(snapshot.cycleId).toBe("htx-poll-0");
  });

  it("throws when HTX returns fewer than 20 bars", async () => {
    const fixture = loadFixture();
    const shortFixture: HtxKlineFixture = {
      ...fixture,
      kline: { ...fixture.kline, data: fixture.kline.data!.slice(0, 10) },
    };
    const poll = new HtxBarPollSource({
      fetchImpl: createMockFetch(shortFixture),
      cycleIdPrefix: "test-htx-poll",
    });

    await expect(poll.fetchSnapshot()).rejects.toThrow(/need at least 20/);
  });

  it("reset restores cycleIndex", async () => {
    const fixture = loadFixture();
    const poll = new HtxBarPollSource({
      fetchImpl: createMockFetch(fixture),
      cycleIdPrefix: "test-htx-poll",
    });

    await poll.fetchSnapshot();
    poll.reset();
    const afterReset = await poll.fetchSnapshot();

    expect(afterReset.cycleIndex).toBe(0);
    expect(afterReset.cycleId).toBe("test-htx-poll-0");
  });
});
