import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { defineInformationAcquisitionSelectionV1 } from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import { captureProviderSnapshot } from "@/lib/trader/market-data/capture/capture-provider-snapshot";
import {
  createHtxGatewayMockFetch,
  jsonResponse,
  type HtxKlineFixture,
} from "@/tests/helpers/htx-gateway-mock-fetch";

const PIT = "2026-01-01T00:25:00.000Z";

function loadFixture(): HtxKlineFixture {
  return JSON.parse(
    readFileSync(
      path.join(process.cwd(), "tests/fixtures/trader/htx-kline-btcusdt-1m.json"),
      "utf8",
    ),
  ) as HtxKlineFixture;
}

function mockFetch(optionalUrls: string[]): typeof fetch {
  const htx = createHtxGatewayMockFetch(loadFixture());
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    if (url.hostname.includes("huobi") || url.hostname.includes("htx")) return htx(input, init);
    optionalUrls.push(url.toString());
    if (url.hostname === "api.alternative.me") {
      return jsonResponse({
        name: "Fear and Greed Index",
        data: [
          {
            value: "51",
            value_classification: "Neutral",
            timestamp: String(Math.floor(Date.now() / 1000)),
          },
        ],
      });
    }
    throw new Error(`Unexpected optional fetch: ${url.toString()}`);
  }) as typeof fetch;
}

describe("DEE-698 selective provider sidecar capture", () => {
  it("captures mandatory HTX only when no plan-derived selection is supplied", async () => {
    const optionalUrls: string[] = [];
    const sidecar = await captureProviderSnapshot({ fetchImpl: mockFetch(optionalUrls) });

    expect(optionalUrls).toEqual([]);
    expect(sidecar.captureOutcomes?.htx_spot).toBe("CAPTURED_HEALTHY");
    expect(sidecar.captureOutcomes?.alternative_me).toBe("UNAVAILABLE");
    expect(sidecar.lanes.fear_greed_index).toBeUndefined();
  });

  it("captures an optional lane only under the exact asserted selection", async () => {
    const optionalUrls: string[] = [];
    const informationSelection = defineInformationAcquisitionSelectionV1({
      planId: "plan-capture-1",
      planContentDigest: "a".repeat(64),
      organizationId: "org-a",
      accountId: null,
      symbol: "BTC/USDT",
      pitAnchor: PIT,
      purpose: "RESEARCH",
      mode: "LIVE",
      requestedSources: [
        {
          needId: "need-fear-greed",
          requirementId: "req-fear-greed",
          providerId: "alternative_me",
          allowedObservationKinds: ["fear_greed_index"],
          costUnits: 1,
          reasonCodes: ["ACTIVE_QUESTION"],
        },
      ],
    });

    const sidecar = await captureProviderSnapshot({
      fetchImpl: mockFetch(optionalUrls),
      informationSelection,
    });

    expect(optionalUrls).toHaveLength(1);
    expect(sidecar.captureOutcomes?.alternative_me).toBe("CAPTURED_HEALTHY");
    expect(sidecar.lanes.fear_greed_index).toMatchObject({ value: 51, classification: "Neutral" });
  });
});
