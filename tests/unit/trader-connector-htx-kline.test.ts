import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { HTX_ENDPOINTS } from "@/lib/trader/connectors/htx/config";
import { HtxRestClient, HtxApiError } from "@/lib/trader/connectors/htx/client";
import type { HtxKlineResponse, HtxMarketMergedResponse } from "@/lib/trader/connectors/htx/types";

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

describe("HtxRestClient.getMarketHistoryKline (AT-E3 S4)", () => {
  it("requests btcusdt 1min klines with default size 25", async () => {
    const fixture = loadFixture();
    let requestedUrl = "";

    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      requestedUrl = url.toString();
      if (url.pathname.endsWith(HTX_ENDPOINTS.marketHistoryKline)) {
        return jsonResponse(fixture.kline);
      }
      throw new Error(`Unexpected fetch: ${url.toString()}`);
    }) as typeof fetch;

    const client = new HtxRestClient({
      apiKey: "public",
      apiSecret: "public",
      fetchImpl,
    });

    const rows = await client.getMarketHistoryKline({
      symbol: "btcusdt",
      period: "1min",
    });

    expect(requestedUrl).toContain(`${HTX_ENDPOINTS.marketHistoryKline}?`);
    expect(requestedUrl).toContain("symbol=btcusdt");
    expect(requestedUrl).toContain("period=1min");
    expect(requestedUrl).toContain("size=25");
    expect(rows).toHaveLength(25);
  });

  it("throws HtxApiError on HTX error envelope", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        status: "error",
        "err-code": "invalid-parameter",
        "err-msg": "invalid symbol",
      })) as typeof fetch;

    const client = new HtxRestClient({
      apiKey: "public",
      apiSecret: "public",
      fetchImpl,
    });

    await expect(
      client.getMarketHistoryKline({ symbol: "btcusdt", period: "1min", size: 25 }),
    ).rejects.toBeInstanceOf(HtxApiError);
  });

  it("throws HtxApiError on HTTP failure", async () => {
    const fetchImpl = (async () => jsonResponse({ status: "error" }, 500)) as typeof fetch;

    const client = new HtxRestClient({
      apiKey: "public",
      apiSecret: "public",
      fetchImpl,
    });

    await expect(
      client.getMarketHistoryKline({ symbol: "btcusdt", period: "1min", size: 25 }),
    ).rejects.toBeInstanceOf(HtxApiError);
  });
});
