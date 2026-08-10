import { describe, expect, it } from "vitest";

import {
  assertNoForbiddenPatternSignal,
  assertPatternResearchOnlyAuthority,
  assertTransitionMatrixRowSums,
  computePatternDefinitionDigest,
  computePatternOccurrenceDigest,
  PATTERN_RESEARCH_AUTHORITY,
} from "@/lib/trader/mi/pattern-research/pattern-research-v1";

describe("DEE-533 pattern research substrate", () => {
  it("definition digest is stable", () => {
    const input = {
      organizationId: "org-1",
      patternKey: "dynamical-ablation-level",
      quantizerVersion: "quantizeScale8HalfUp/v1",
      stateVectorVersion: "feature-engine/rv/v2",
      ablationLevel: "level+slope" as const,
      vTilde: [0.1, 0.2, 0.3],
    };
    expect(computePatternDefinitionDigest(input)).toHaveLength(64);
    expect(computePatternDefinitionDigest(input)).toBe(computePatternDefinitionDigest(input));
  });

  it("rejects forbidden modulo-9 pattern keys", () => {
    expect(() => assertNoForbiddenPatternSignal("modulo-9-signal")).toThrow();
  });

  it("enforces RESEARCH_ONLY authority", () => {
    expect(() => assertPatternResearchOnlyAuthority("CAPITAL")).toThrow();
    expect(() => assertPatternResearchOnlyAuthority(PATTERN_RESEARCH_AUTHORITY)).not.toThrow();
  });

  it("transition matrix rows sum to 1", () => {
    assertTransitionMatrixRowSums([
      [0.7, 0.2, 0.1],
      [0.1, 0.8, 0.1],
    ]);
  });

  it("occurrence digest binds recurrence stats", () => {
    const digest = computePatternOccurrenceDigest({
      patternDefinitionDigest: "a".repeat(64),
      anchorClosedBarEpochMs: 1_700_000_000_000,
      symbol: "BTCUSDT",
      recurrenceCount: 3,
      transitionRowSums: [1, 1],
    });
    expect(digest).toHaveLength(64);
  });
});
