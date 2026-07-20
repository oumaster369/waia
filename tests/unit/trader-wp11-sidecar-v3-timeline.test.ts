/**
 * HTR-WP11 — sidecar v3 timeline parse + PIT resolution.
 */
import { describe, expect, it } from "vitest";

import {
  parseReplayProviderSidecar,
  REPLAY_PROVIDER_SIDECAR_V3,
} from "@/lib/trader/market-data/replay/provider-sidecar-types";
import {
  resolveSidecarTimelinesAtPit,
  sidecarV3Lanes,
} from "@/lib/trader/market-data/replay/replay-pit-selector";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

describe("HTR-WP11 sidecar v3 timeline", () => {
  it("parseReplayProviderSidecar accepts v3 schema", () => {
    const payload = {
      schemaVersion: REPLAY_PROVIDER_SIDECAR_V3,
      instrumentId: "BTC/USDT",
      generatedBy: "tests/unit/trader-wp11-sidecar-v3-timeline.test.ts",
      lanes: {
        fear_greed_index: [
          {
            eventTimeUtc: "2026-01-01T00:20:00.000Z",
            availableAtUtc: "2026-01-01T00:21:00.000Z",
            ingestTimeUtc: "2026-01-01T00:21:30.000Z",
            providerId: "alternative_me",
            feedKind: "fear_greed_index",
            sourceDigest: computeStableJsonDigest({ value: 75, classification: "Greed" }),
            payload: {
              value: 75,
              classification: "Greed",
              eventTimeUtc: "2026-01-01T00:20:00.000Z",
            },
          },
        ],
      },
    };

    const parsed = parseReplayProviderSidecar(payload);
    expect(parsed.schemaVersion).toBe(REPLAY_PROVIDER_SIDECAR_V3);
  });

  it("sidecarV3Lanes preserves timeline fields without mutation", () => {
    const timelineEntry = {
      eventTimeUtc: "2026-01-01T00:20:00.000Z",
      availableAtUtc: "2026-01-01T00:21:00.000Z",
      ingestTimeUtc: "2026-01-01T00:21:30.000Z",
      providerId: "alternative_me" as const,
      feedKind: "fear_greed_index",
      sourceDigest: "abc123",
      payload: { value: 75 },
    };

    const timelines = sidecarV3Lanes({ fear_greed_index: [timelineEntry] });
    expect(timelines.fear_greed_index?.[0]).toEqual(timelineEntry);
  });

  it("resolveSidecarTimelinesAtPit excludes future availability at evaluatedAt", () => {
    const evaluatedAtUtc = "2026-01-01T00:25:00.000Z";
    const eligibleDigest = computeStableJsonDigest({ value: 70 });
    const futureDigest = computeStableJsonDigest({ value: 80 });

    const resolved = resolveSidecarTimelinesAtPit({
      evaluatedAtUtc,
      timelines: sidecarV3Lanes({
        fear_greed_index: [
          {
            eventTimeUtc: "2026-01-01T00:20:00.000Z",
            availableAtUtc: "2026-01-01T00:24:00.000Z",
            ingestTimeUtc: "2026-01-01T00:24:30.000Z",
            providerId: "alternative_me",
            feedKind: "fear_greed_index",
            sourceDigest: eligibleDigest,
            payload: { value: 70 },
          },
          {
            eventTimeUtc: "2026-01-01T00:22:00.000Z",
            availableAtUtc: "2026-01-01T00:26:00.000Z",
            ingestTimeUtc: "2026-01-01T00:26:30.000Z",
            providerId: "alternative_me",
            feedKind: "fear_greed_index",
            sourceDigest: futureDigest,
            payload: { value: 80 },
          },
        ],
      }),
    });

    expect(resolved.fear_greed_index).toBeDefined();
    expect(Array.isArray(resolved.fear_greed_index)).toBe(false);
    expect((resolved.fear_greed_index as { sourceDigest: string }).sourceDigest).toBe(
      eligibleDigest,
    );
  });
});
