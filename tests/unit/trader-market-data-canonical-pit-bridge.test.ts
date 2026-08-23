import { describe, expect, it } from "vitest";

import { listCanonicalPitGatewayCandidates } from "@/lib/trader/market-data/market-data-gateway";
import { prepareCanonicalPitAttemptV1 } from "@/lib/trader/market-data/normalization/gateway-to-canonical-pit";
import {
  FUSED_CONTEXT_SCHEMA_VERSION,
  OBSERVATION_SCHEMA_VERSION,
  type FusedMarketContext,
  type NormalizedObservation,
} from "@/lib/trader/market-data/observation-types";

function quote(overrides: Partial<NormalizedObservation> = {}): NormalizedObservation {
  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "quote_l1",
    sessionPhase: "US",
    provenance: {
      providerId: "htx_spot",
      venue: "htx",
      feedKind: "quote_l1",
      symbol: "BTC/USDT",
      eventTimeUtc: "2026-08-23T10:00:00.000Z",
      ingestTimeUtc: "2026-08-23T10:00:01.000Z",
    },
    health: "HEALTHY",
    freshnessMs: 1_000,
    latencyMs: 10,
    confidence: 0.9,
    payload: { bid: "100", ask: "101", last: "100.5", timestamp: "2026-08-23T10:00:00.000Z" },
    ...overrides,
  };
}

describe("DEE-683 gateway to canonical PIT bridge", () => {
  it("prepares one deterministic AVAILABLE attempt without substitute data", () => {
    const first = prepareCanonicalPitAttemptV1(quote());
    const second = prepareCanonicalPitAttemptV1(quote());
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      status: "AVAILABLE",
      reason: null,
      kind: "quote_l1",
      subjectRef: "BTC/USDT",
      availableAtUtc: "2026-08-23T10:00:01.000Z",
      ingestTimeUtc: "2026-08-23T10:00:01.000Z",
    });
    expect(first.payloadCanonical).toEqual({
      ask: "101",
      bid: "100",
      last: "100.5",
      timestamp: "2026-08-23T10:00:00.000Z",
    });
  });

  it("rejects excluded, stale, invalid, and unavailable inputs explicitly", () => {
    const excluded = prepareCanonicalPitAttemptV1(
      quote({
        kind: "cross_exchange_confirmation",
        provenance: {
          ...quote().provenance,
          providerId: "binance_public",
          venue: "binance",
          feedKind: "cross_exchange_confirmation",
        },
      }),
    );
    expect(excluded).toMatchObject({
      status: "REJECTED",
      reason: "EXCLUDED_UNMODELED",
      payloadCanonical: null,
    });

    expect(prepareCanonicalPitAttemptV1(quote({ health: "STALE" }))).toMatchObject({
      status: "REJECTED",
      reason: "STALE_INPUT",
      payloadCanonical: null,
    });
    expect(
      prepareCanonicalPitAttemptV1(
        quote({
          provenance: {
            ...quote().provenance,
            eventTimeUtc: "2026-08-23T10:00:02.000Z",
          },
        }),
      ),
    ).toMatchObject({ status: "REJECTED", reason: "INVALID_CHRONOLOGY" });
    expect(prepareCanonicalPitAttemptV1(quote({ health: "UNAVAILABLE" }))).toMatchObject({
      status: "UNAVAILABLE",
      reason: "SOURCE_UNAVAILABLE",
      payloadCanonical: null,
    });
  });

  it("exposes each gateway-shaped input once to the persistence boundary", () => {
    const observation = quote();
    const context: FusedMarketContext = {
      schemaVersion: FUSED_CONTEXT_SCHEMA_VERSION,
      fusedAtUtc: "2026-08-23T10:00:01.000Z",
      instrumentId: "BTC/USDT",
      sessionPhase: "US",
      mtfBars: {},
      primaryQuote: observation,
      aggregateHealth: "HEALTHY",
      aggregateConfidence: 0.9,
      provenance: [observation.provenance],
      degradationReasons: [],
    };
    expect(
      listCanonicalPitGatewayCandidates(context, { binance: observation }),
    ).toEqual([observation]);
  });
});
