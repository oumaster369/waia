import { describe, expect, it } from "vitest";

import { prepareCanonicalPitAttemptV1 } from "@/lib/trader/market-data/normalization/gateway-to-canonical-pit";
import { OBSERVATION_SCHEMA_VERSION, type NormalizedObservation } from "@/lib/trader/market-data/observation-types";
import { prepareCanonicalPitReplayBatchV1 } from "@/lib/trader/market-data/replay/canonical-pit-replay";
import { ensureExplicitAbsentLanes } from "@/lib/trader/market-data/replay/replay-lane-normalizer";

function observation(): NormalizedObservation {
  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    kind: "news_headline",
    sessionPhase: "EUROPE",
    provenance: {
      providerId: "coindesk_rss",
      venue: "coindesk",
      feedKind: "news_headline",
      symbol: "GLOBAL",
      eventTimeUtc: "2026-08-23T09:00:00.000Z",
      ingestTimeUtc: "2026-08-23T09:00:05.000Z",
    },
    health: "HEALTHY",
    freshnessMs: 5_000,
    latencyMs: 25,
    confidence: 0.8,
    payload: {
      headline: "Protocol activity update",
      url: "https://example.invalid/item",
      source: "CoinDesk",
      publishedAt: "2026-08-23T09:00:00.000Z",
    },
  };
}

describe("DEE-683 canonical PIT replay convergence", () => {
  it("produces the exact gateway attempt when the input is PIT-visible", () => {
    const gateway = prepareCanonicalPitAttemptV1(observation());
    const [replay] = prepareCanonicalPitReplayBatchV1({
      evaluatedAtUtc: "2026-08-23T09:00:05.000Z",
      observations: [observation()],
    });
    expect(replay).toEqual(gateway);
  });

  it("rejects future replay evidence without stale, zero, or synthetic fallback", () => {
    const [future] = prepareCanonicalPitReplayBatchV1({
      evaluatedAtUtc: "2026-08-23T09:00:04.999Z",
      observations: [observation()],
    });
    expect(future).toMatchObject({
      status: "REJECTED",
      reason: "INVALID_CHRONOLOGY",
      payloadCanonical: null,
    });
  });

  it("rejects an invalid replay cutoff", () => {
    expect(() =>
      prepareCanonicalPitReplayBatchV1({ evaluatedAtUtc: "invalid", observations: [observation()] }),
    ).toThrow("CANONICAL_PIT_REPLAY_INVALID_CUTOFF");
  });

  it("keeps an explicit absent news lane UNAVAILABLE under registered provenance", () => {
    const evaluatedAt = "2026-08-23T09:00:05.000Z";
    const bundle = ensureExplicitAbsentLanes({
      bundle: {},
      instrumentId: "BTC/USDT",
      evaluatedAt,
      degradationReasons: [],
    });
    const absentHeadline = bundle.newsEvidence.find((entry) => entry.kind === "news_headline");

    expect(absentHeadline?.provenance).toMatchObject({
      providerId: "coindesk_rss",
      venue: "coindesk",
      feedKind: "news_headline",
    });
    expect(prepareCanonicalPitAttemptV1(absentHeadline!)).toMatchObject({
      status: "UNAVAILABLE",
      reason: "SOURCE_UNAVAILABLE",
      payloadCanonical: null,
    });
  });
});
