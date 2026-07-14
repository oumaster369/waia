/**
 * HTR-WP10 — replay repro digest stability (volatile key stripping + canonical JSON).
 */
import { describe, expect, it } from "vitest";

import { computeReplayReproContentDigest } from "@/lib/trader/research/replay-repro-digest";

describe("HTR-WP10 digest stability", () => {
  it("strips msvId and generatedAt from semantic repro digest", () => {
    const payload = {
      msvId: "volatile-msv-a",
      generatedAt: "2026-01-01T00:00:00.000Z",
      derived: { regime: "RANGE", tradingPermission: "TRADE" },
    };
    const alternate = {
      msvId: "volatile-msv-b",
      generatedAt: "2099-12-31T23:59:59.999Z",
      derived: { regime: "RANGE", tradingPermission: "TRADE" },
    };
    expect(computeReplayReproContentDigest(payload)).toBe(
      computeReplayReproContentDigest(alternate),
    );
  });

  it("preserves semantic featureSetId and strategySignalId when injected deterministically", () => {
    const first = {
      featureSetId: "00000000-0000-4000-8000-00000004157001",
      strategySignalId: "00000000-0000-4000-8000-00000004157002",
      outcome: "SIGNAL",
    };
    const second = {
      featureSetId: "00000000-0000-4000-8000-00000004157001",
      strategySignalId: "00000000-0000-4000-8000-00000004157002",
      outcome: "SIGNAL",
    };
    const drifted = {
      featureSetId: "00000000-0000-4000-8000-00000004157999",
      strategySignalId: "00000000-0000-4000-8000-00000004157002",
      outcome: "SIGNAL",
    };
    expect(computeReplayReproContentDigest(first)).toBe(computeReplayReproContentDigest(second));
    expect(computeReplayReproContentDigest(first)).not.toBe(
      computeReplayReproContentDigest(drifted),
    );
  });

  it("canonicalizes unordered object key insertion", () => {
    const a = { z: 1, a: 2, nested: { y: 3, b: 4 } };
    const b = { a: 2, nested: { b: 4, y: 3 }, z: 1 };
    expect(computeReplayReproContentDigest(a)).toBe(computeReplayReproContentDigest(b));
  });
});
