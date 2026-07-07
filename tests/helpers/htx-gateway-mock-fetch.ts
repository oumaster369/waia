import { HTX_ENDPOINTS } from "@/lib/trader/connectors/htx/config";
import type { HtxKlineResponse, HtxMarketMergedResponse } from "@/lib/trader/connectors/htx/types";

export type HtxKlineFixture = {
  kline: HtxKlineResponse;
  merged: HtxMarketMergedResponse;
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Mock fetch for gateway-backed HTX poll (all MTF kline periods + merged ticker). */
export function createHtxGatewayMockFetch(fixture: HtxKlineFixture): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    if (
      url.pathname.endsWith(HTX_ENDPOINTS.marketHistoryKline) ||
      url.pathname.endsWith(HTX_ENDPOINTS.marketHistoryCandles)
    ) {
      return jsonResponse(fixture.kline);
    }
    if (url.pathname.endsWith(HTX_ENDPOINTS.marketDetailMerged)) {
      return jsonResponse(fixture.merged);
    }
    throw new Error(`Unexpected fetch: ${url.toString()}`);
  }) as typeof fetch;
}

export function htxPollSourceOptions(
  fixture: HtxKlineFixture,
  overrides: Record<string, unknown> = {},
) {
  return {
    fetchImpl: createHtxGatewayMockFetch(fixture),
    disableOptionalProviders: true,
    ...overrides,
  };
}
