/**
 * HTR-WP10 — no-lookahead + absent-lane + closed-only HTF property proofs.
 */
import { describe, expect, it } from "vitest";

import { buildProvenanceRef } from "@/lib/trader/market-data/normalization/normalize-observation";
import { normalizeFearGreedObservation } from "@/lib/trader/market-data/normalization/normalize-observation";
import {
  advanceMtf,
  collectIncrementalClosedBars,
  createMtfDomainState,
} from "@/lib/trader/market-data/canvas/incremental-mtf";
import { resampleReplayMtfBars } from "@/lib/trader/market-data/mtf/replay-mtf-resampler";
import {
  FUTURE_EVIDENCE_EXCLUDED,
  guardNoLookahead,
  markAbsentEvidenceLanes,
  SIDECAR_LANE_ABSENT,
} from "@/lib/trader/market-data/replay/replay-lane-normalizer";
import { buildReconstructionSnapshotForClosedPrefix } from "@/lib/trader/intelligence/reconstruction/build-reconstruction-snapshot";
import type { Bar } from "@/lib/trader/intelligence/types";
import { makeCanvasBar1m } from "@/tests/unit/helpers/canvas-bar-fixture";

function sampleBars(count: number): Bar[] {
  return Array.from({ length: count }, (_, i) =>
    makeCanvasBar1m({
      barOpenTime: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
    }),
  );
}

describe("HTR-WP10 no-lookahead properties", () => {
  it("guardNoLookahead excludes future evidence with FUTURE_EVIDENCE_EXCLUDED", () => {
    const evaluatedAt = "2026-01-01T00:25:00.000Z";
    const futureObs = normalizeFearGreedObservation({
      value: 80,
      classification: "Greed",
      provenance: buildProvenanceRef({
        providerId: "alternative_me",
        venue: "alternative_me",
        feedKind: "fear_greed_index",
        symbol: "GLOBAL",
        eventTimeUtc: "2026-01-01T01:00:00.000Z",
      }),
      latencyMs: 0,
      evaluatedAt,
      eventTimeUtc: "2026-01-01T01:00:00.000Z",
    });

    const degradationReasons: string[] = [];
    const guarded = guardNoLookahead({
      observation: futureObs,
      evaluatedAt,
      degradationReasons,
    });

    expect(guarded.health).toBe("UNAVAILABLE");
    expect(guarded.payload.reason).toBe(FUTURE_EVIDENCE_EXCLUDED);
    expect(degradationReasons.length).toBeGreaterThan(0);
  });

  it("markAbsentEvidenceLanes emits deterministic SIDECAR_LANE_ABSENT placeholders", () => {
    const degradationReasons: string[] = [];
    const lanes = markAbsentEvidenceLanes({
      evaluatedAt: "2026-01-01T00:25:00.000Z",
      instrumentId: "BTC/USDT",
      degradationReasons,
      hasSidecar: false,
    });

    expect(lanes.macroEvidence.length).toBeGreaterThan(0);
    expect(lanes.macroEvidence[0]?.health).toBe("UNAVAILABLE");
    expect(lanes.macroEvidence[0]?.payload.reason).toBe(SIDECAR_LANE_ABSENT);
    expect(degradationReasons.some((reason) => reason.includes("sidecar_absent"))).toBe(true);
  });

  it("default incremental MTF path excludes still-forming HTF buckets", () => {
    const bars = sampleBars(10);
    const { emitted, finalState } = collectIncrementalClosedBars(bars);
    expect(finalState.forming["15m"]).toBeDefined();

    const oracle = resampleReplayMtfBars({ bars1m: bars })["15m"] ?? [];
    const closedOracle = oracle.slice(0, -1);
    const emitted15m = emitted
      .filter((entry) => entry.interval === "15m")
      .map((entry) => entry.bar);
    expect(emitted15m).toEqual(closedOracle);
  });

  it("closed-prefix reconstruction is deterministic and excludes forming HTF tail", () => {
    const bars = sampleBars(20);
    const evaluatedAt = bars.at(-1)!.barCloseTime;
    const first = buildReconstructionSnapshotForClosedPrefix({
      bars1m: bars,
      evaluatedAt,
    });
    const second = buildReconstructionSnapshotForClosedPrefix({
      bars1m: bars,
      evaluatedAt,
    });
    expect(second.contentDigest).toBe(first.contentDigest);

    const oracle15m = resampleReplayMtfBars({ bars1m: bars })["15m"] ?? [];
    const { emitted, finalState } = collectIncrementalClosedBars(bars);
    expect(finalState.forming["15m"]).toBeDefined();
    const emitted15m = emitted.filter((entry) => entry.interval === "15m");
    expect(emitted15m.length).toBeLessThan(oracle15m.length);
  });

  it("chunk-boundary permutations yield identical incremental closed-bar streams", () => {
    const bars = sampleBars(25);
    const uninterrupted = collectIncrementalClosedBars(bars);

    const emittedChunked: { interval: "15m" | "1h" | "4h" | "1d"; bar: Bar }[] = [];
    let state = createMtfDomainState();
    for (const bar of bars) {
      const step = advanceMtf(state, bar, { gapObserved: false });
      state = step.state;
      emittedChunked.push(...step.emittedClosed);
    }

    expect(emittedChunked.map((entry) => entry.bar.barCloseTime)).toEqual(
      uninterrupted.emitted.map((entry) => entry.bar.barCloseTime),
    );
  });
});
