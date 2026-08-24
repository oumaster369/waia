import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { defineInformationAcquisitionSelectionV1 } from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import { MarketDataGateway } from "@/lib/trader/market-data/market-data-gateway";
import {
  buildProvenanceRef,
  normalizeCrossExchangeConfirmation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import { prepareCanonicalPitAttemptV1 } from "@/lib/trader/market-data/normalization/gateway-to-canonical-pit";
import {
  getMarketDataProvider,
  listMarketDataProviders,
  resolveMarketDataProviderSelection,
} from "@/lib/trader/market-data/provider-registry";
import {
  defineInformationAcquisitionReceiptV1,
  type InformationAcquisitionOutcomeV1,
} from "@/lib/trader/market-data/types";
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
    const pitAnchor = new Date(Date.now() + 60_000).toISOString();
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
        observations: [bundle.fusedContext.fearGreed!],
      }),
    ).toThrow("canonicalPitAttempts");
  });

  it("rejects optional evidence whose event or availability is later than the exact live PIT", async () => {
    const optionalUrls: string[] = [];
    const gateway = new MarketDataGateway({ fetchImpl: selectiveFetch(optionalUrls) });
    const bundle = await gateway.pollEvaluationBundle({
      evaluatedAt: PIT,
      informationSelection: selection([source("alternative_me", ["fear_greed_index"])]),
    });

    expect(optionalUrls).toHaveLength(1);
    expect(bundle.informationAcquisition?.outcomes[0]).toMatchObject({
      status: "REJECTED",
      reasonCode: "INVALID_CHRONOLOGY",
      observationContentDigests: [],
    });
    expect(bundle.fusedContext.fearGreed).toBeUndefined();
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

  it("rejects falsely advertised cross-venue quote capability without a provider call", async () => {
    const pitAnchor = new Date().toISOString();
    const optionalUrls: string[] = [];
    const gateway = new MarketDataGateway({ fetchImpl: selectiveFetch(optionalUrls) });

    const bundle = await gateway.pollEvaluationBundle({
      evaluatedAt: pitAnchor,
      informationSelection: selection([source("binance_public", ["quote_l1"])], pitAnchor),
    });

    expect(optionalUrls).toEqual([]);
    expect(bundle.informationAcquisition?.outcomes[0]).toMatchObject({
      status: "REJECTED",
      reasonCode: "PROVIDER_KIND_MISMATCH",
      observationContentDigests: [],
    });
    expect(bundle.fusedContext.crossExchangeConfirmation).toBeUndefined();
  });

  it("deep-freezes provider authorization descriptors and returned collections", () => {
    const descriptor = getMarketDataProvider("alternative_me");
    const providers = listMarketDataProviders();
    const resolution = resolveMarketDataProviderSelection({
      providerId: "alternative_me",
      allowedObservationKinds: ["fear_greed_index"],
    });

    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.kinds)).toBe(true);
    expect(Object.isFrozen(providers)).toBe(true);
    expect(Object.isFrozen(resolution)).toBe(true);
    expect(resolution.status).toBe("ACCEPTED");
    if (resolution.status === "ACCEPTED")
      expect(Object.isFrozen(resolution.admittedKinds)).toBe(true);
    expect(() => (descriptor.kinds as string[]).push("quote_l1")).toThrow();
    expect(getMarketDataProvider("alternative_me").kinds).toEqual(["fear_greed_index"]);
  });

  it("rejects forged excluded, source, future, and arbitrary-digest AVAILABLE attempts", async () => {
    const pitAnchor = new Date(Date.now() + 60_000).toISOString();
    const optionalUrls: string[] = [];
    const gateway = new MarketDataGateway({ fetchImpl: selectiveFetch(optionalUrls) });
    const selected = selection([source("alternative_me", ["fear_greed_index"])], pitAnchor);
    const bundle = await gateway.pollEvaluationBundle({
      evaluatedAt: pitAnchor,
      informationSelection: selected,
    });
    const outcome = bundle.informationAcquisition!.outcomes[0]!;
    const observation = bundle.fusedContext.fearGreed!;
    const expectRejected = (
      forgedOutcome: InformationAcquisitionOutcomeV1,
      observations: Parameters<typeof defineInformationAcquisitionReceiptV1>[0]["observations"],
    ) =>
      expect(() =>
        defineInformationAcquisitionReceiptV1({
          selection: selected,
          outcomes: [forgedOutcome],
          observations,
        }),
      ).toThrow();

    expectRejected(
      {
        ...outcome,
        canonicalPitAttempts: [
          { ...outcome.canonicalPitAttempts[0]!, normalizedInputDigest: DIGEST },
        ],
        observationContentDigests: [DIGEST],
      },
      [observation],
    );
    expectRejected(
      {
        ...outcome,
        canonicalPitAttempts: [{ ...outcome.canonicalPitAttempts[0]!, providerId: "coindesk_rss" }],
      },
      [observation],
    );

    const futureObservation = {
      ...observation,
      provenance: {
        ...observation.provenance,
        eventTimeUtc: new Date(Date.parse(pitAnchor) + 60_000).toISOString(),
        ingestTimeUtc: new Date(Date.parse(pitAnchor) + 60_000).toISOString(),
      },
    };
    const futureAttempt = prepareCanonicalPitAttemptV1(futureObservation, {
      pitCutoffUtc: pitAnchor,
    });
    expectRejected(
      {
        ...outcome,
        canonicalPitAttempts: [{ ...futureAttempt, status: "AVAILABLE", reason: null }],
        observationContentDigests: [futureAttempt.normalizedInputDigest],
      },
      [futureObservation],
    );
    expectRejected(
      {
        ...outcome,
        status: "REJECTED",
        reasonCode: "EXCLUDED_UNMODELED",
        canonicalPitAttempts: [futureAttempt],
        observationContentDigests: [],
      },
      [futureObservation],
    );

    const excludedObservation = normalizeCrossExchangeConfirmation({
      symbol: "BTC/USDT",
      primaryLast: "64000",
      confirmLast: "64001",
      confirmVenue: "binance",
      provenance: buildProvenanceRef({
        providerId: "binance_public",
        venue: "binance",
        feedKind: "cross_exchange_confirmation",
        symbol: "BTC/USDT",
        eventTimeUtc: new Date().toISOString(),
      }),
      latencyMs: 0,
      evaluatedAt: pitAnchor,
    });
    const excludedAttempt = prepareCanonicalPitAttemptV1(excludedObservation, {
      pitCutoffUtc: pitAnchor,
    });
    const binanceSelection = selection([source("binance_public", ["quote_l1"])], pitAnchor);
    expect(() =>
      defineInformationAcquisitionReceiptV1({
        selection: binanceSelection,
        outcomes: [
          {
            requestedSource: binanceSelection.requestedSources[0]!,
            status: "AVAILABLE",
            reasonCode: null,
            canonicalPitAttempts: [
              {
                ...excludedAttempt,
                status: "AVAILABLE",
                reason: null,
                kind: "quote_l1",
              },
            ],
            observationContentDigests: [excludedAttempt.normalizedInputDigest],
          },
        ],
        observations: [excludedObservation],
      }),
    ).toThrow("attemptLineage");
  });
});
