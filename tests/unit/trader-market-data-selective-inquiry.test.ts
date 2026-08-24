import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { defineInformationAcquisitionSelectionV1 } from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import { MarketDataGateway } from "@/lib/trader/market-data/market-data-gateway";
import { defineInformationAcquisitionReceiptV1 } from "@/lib/trader/market-data/types";
import {
  createHtxGatewayMockFetch,
  jsonResponse,
  type HtxKlineFixture,
} from "@/tests/helpers/htx-gateway-mock-fetch";

const PIT = "2026-01-01T14:00:00.000Z";
const DIGEST = "a".repeat(64);

function loadFixture(): HtxKlineFixture {
  return JSON.parse(
    readFileSync(
      path.join(process.cwd(), "tests/fixtures/trader/htx-kline-btcusdt-1m.json"),
      "utf8",
    ),
  ) as HtxKlineFixture;
}

function selection(
  requestedSources: Parameters<
    typeof defineInformationAcquisitionSelectionV1
  >[0]["requestedSources"],
  pitAnchor = PIT,
) {
  return defineInformationAcquisitionSelectionV1({
    planId: "plan-live-1",
    planContentDigest: DIGEST,
    organizationId: "org-a",
    accountId: "acct-a",
    symbol: "BTC/USDT",
    pitAnchor,
    purpose: "OPEN_POSITION_REASSESSMENT",
    mode: "LIVE",
    requestedSources,
  });
}

function source(
  providerId: string,
  allowedObservationKinds: readonly ("fear_greed_index" | "quote_l1")[],
) {
  return {
    needId: `need-${providerId}`,
    requirementId: `req-${providerId}`,
    providerId,
    allowedObservationKinds,
    costUnits: 1,
    reasonCodes: ["ACTIVE_QUESTION"],
  };
}

function selectiveFetch(optionalUrls: string[]): typeof fetch {
  const htx = createHtxGatewayMockFetch(loadFixture());
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    if (url.hostname.includes("huobi") || url.hostname.includes("htx")) {
      return htx(input, init);
    }
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
    if (url.hostname === "api.binance.com") {
      return jsonResponse({ symbol: "BTCUSDT", price: "64000" });
    }
    throw new Error(`Unexpected optional fetch: ${url.toString()}`);
  }) as typeof fetch;
}

describe("DEE-698 selective live information acquisition", () => {
  it("makes zero optional calls when the exact selection is absent", async () => {
    const optionalUrls: string[] = [];
    const gateway = new MarketDataGateway({ fetchImpl: selectiveFetch(optionalUrls) });

    const bundle = await gateway.pollEvaluationBundle({ evaluatedAt: PIT });

    expect(optionalUrls).toEqual([]);
    expect(bundle.informationAcquisition).toBeNull();
    expect(bundle.fusedContext.primaryQuote).toBeDefined();
    expect(bundle.fusedContext.mtfBars["1d"]).toBeDefined();
  });

  it("calls only the selected compatible provider and seals an AVAILABLE receipt", async () => {
    const pitAnchor = new Date().toISOString();
    const optionalUrls: string[] = [];
    const gateway = new MarketDataGateway({ fetchImpl: selectiveFetch(optionalUrls) });

    const selected = selection([source("alternative_me", ["fear_greed_index"])], pitAnchor);
    const bundle = await gateway.pollEvaluationBundle({
      evaluatedAt: pitAnchor,
      informationSelection: selected,
    });

    expect(optionalUrls).toHaveLength(1);
    expect(optionalUrls[0]).toContain("api.alternative.me/fng/");
    expect(bundle.informationAcquisition?.outcomes).toMatchObject([
      { status: "AVAILABLE", reasonCode: null },
    ]);
    expect(bundle.fusedContext.fearGreed?.provenance.providerId).toBe("alternative_me");
    expect(bundle.informationAcquisition?.causalObservationContentDigests).toHaveLength(1);
    expect(() =>
      defineInformationAcquisitionReceiptV1({
        selection: selected,
        outcomes: [
          {
            ...bundle.informationAcquisition!.outcomes[0]!,
            observationContentDigests: [DIGEST],
          },
        ],
      }),
    ).toThrow("canonicalPitAttempts");
  });

  it("rejects unknown and kind-incompatible providers without calling them", async () => {
    const optionalUrls: string[] = [];
    const gateway = new MarketDataGateway({ fetchImpl: selectiveFetch(optionalUrls) });

    const bundle = await gateway.pollEvaluationBundle({
      evaluatedAt: PIT,
      informationSelection: selection([
        source("unknown-provider", ["quote_l1"]),
        source("coingecko_global", ["fear_greed_index"]),
      ]),
    });

    expect(optionalUrls).toEqual([]);
    expect(bundle.informationAcquisition?.outcomes.map((outcome) => outcome.reasonCode)).toEqual([
      "PROVIDER_KIND_MISMATCH",
      "SOURCE_UNKNOWN",
    ]);
  });

  it("never admits the excluded cross-exchange category as requested quote evidence", async () => {
    const pitAnchor = new Date().toISOString();
    const optionalUrls: string[] = [];
    const gateway = new MarketDataGateway({ fetchImpl: selectiveFetch(optionalUrls) });

    const bundle = await gateway.pollEvaluationBundle({
      evaluatedAt: pitAnchor,
      informationSelection: selection([source("binance_public", ["quote_l1"])], pitAnchor),
    });

    expect(optionalUrls).toHaveLength(1);
    expect(bundle.informationAcquisition?.outcomes[0]).toMatchObject({
      status: "REJECTED",
      reasonCode: "SOURCE_RETURNED_NO_ADMITTED_OBSERVATION",
      observationContentDigests: [],
    });
    expect(bundle.fusedContext.crossExchangeConfirmation).toBeUndefined();
  });
});
