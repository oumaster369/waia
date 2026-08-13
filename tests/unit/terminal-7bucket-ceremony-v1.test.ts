import { describe, expect, it } from "vitest";

import { assertCanonicalOpenTailSemantics } from "@/lib/trader/intelligence/forecast-v2/forecast-v2-persistence-service";
import {
  computeTerminalTargetGridIdentityDigestHex,
  terminalMarginalFromSamplesV1,
} from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import {
  bucketIndexForReturn,
  computeTerminalTargetGridFromDevelopmentReturns,
  empiricalBucketProbabilities,
  TERMINAL_BUCKET_COUNT,
  terminalTargetBucketDefinitionsFromGrid,
} from "@/lib/trader/research/benchmark/target-grid-ceremony-v1";

describe("DEE-527/535 Terminal 7-bucket open-tail ceremony", () => {
  const developmentReturns = Array.from({ length: 200 }, (_, i) => -0.02 + i * 0.0002);
  const grid = computeTerminalTargetGridFromDevelopmentReturns(developmentReturns);
  const digest = computeTerminalTargetGridIdentityDigestHex(grid);

  it("canonical bucket definitions use NULL open tails", () => {
    const defs = terminalTargetBucketDefinitionsFromGrid(grid);
    expect(defs).toHaveLength(7);
    expect(defs[0]).toMatchObject({
      bucketOrdinal: 0,
      tailSemantics: "LOWER_TAIL",
      lowerBound: null,
    });
    expect(defs[0]!.upperBound).toBe(grid.edges[0]);
    expect(defs[6]).toMatchObject({
      bucketOrdinal: 6,
      tailSemantics: "UPPER_TAIL",
      upperBound: null,
    });
    expect(defs[6]!.lowerBound).toBe(grid.edges[5]);
    for (let i = 1; i <= 5; i += 1) {
      expect(defs[i]!.tailSemantics).toBe("INTERIOR");
      expect(defs[i]!.lowerBound).not.toBeNull();
      expect(defs[i]!.upperBound).not.toBeNull();
    }
  });

  it("produces exactly seven masses with NULL open-tail bounds", () => {
    const samples: number[][][] = [
      developmentReturns.slice(0, 50).map((rH) => [0, 0, 0, rH, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ];
    const masses = terminalMarginalFromSamplesV1(samples, grid, digest);
    expect(masses.probabilities).toHaveLength(TERMINAL_BUCKET_COUNT);
    expect(masses.lowerBoundsScale8[0]).toBeNull();
    expect(masses.upperBoundsScale8[6]).toBeNull();
    expect(masses.tailSemantics[0]).toBe("LOWER_TAIL");
    expect(masses.tailSemantics[6]).toBe("UPPER_TAIL");
    const sum = masses.probabilities.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-12);
  });

  it("Terminal masses equal direct R_h marginal; every finite sample maps uniquely", () => {
    const rh = [-1, -0.01, -0.005, 0, 0.005, 0.01, 0.015, 1];
    const samples: number[][][] = [rh.map((r) => [0, 0, 0, r, 0, 0, 0, 0, 0, 0, 0, 0, 0])];
    const masses = terminalMarginalFromSamplesV1(samples, grid, digest);
    const direct = empiricalBucketProbabilities(rh, grid);
    for (let i = 0; i < 7; i += 1) {
      expect(Math.abs((masses.probabilities[i] ?? 0) - (direct[i] ?? 0))).toBeLessThan(1e-12);
    }
    const seen = new Set(rh.map((y) => bucketIndexForReturn(y, grid)));
    expect(seen.size).toBeGreaterThan(1);
    for (const y of rh) {
      const idx = bucketIndexForReturn(y, grid);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(7);
    }
  });

  it("rejects incomplete 6-edge grids and wrong identity", () => {
    const samples: number[][][] = [[[0, 0, 0, 0.001, 0, 0, 0, 0, 0, 0, 0, 0, 0]]];
    expect(() =>
      terminalMarginalFromSamplesV1(
        samples,
        { edges: grid.edges.slice(0, 5), bucketCount: 7 },
        digest,
      ),
    ).toThrow(/incomplete|invalid|7 buckets/i);
    expect(() => terminalMarginalFromSamplesV1(samples, grid, "0".repeat(64))).toThrow(
      /identity mismatch/,
    );
  });

  it("malformed open-tail definitions fail closed", () => {
    const okTails = [
      "LOWER_TAIL",
      "INTERIOR",
      "INTERIOR",
      "INTERIOR",
      "INTERIOR",
      "INTERIOR",
      "UPPER_TAIL",
    ] as const;
    const okLowers = [null, "1", "2", "3", "4", "5", "6"] as const;
    const okUppers = ["1", "2", "3", "4", "5", "6", null] as const;
    expect(() =>
      assertCanonicalOpenTailSemantics(okTails, [...okLowers], [...okUppers]),
    ).not.toThrow();
    expect(() =>
      assertCanonicalOpenTailSemantics(okTails, ["0", ...okLowers.slice(1)], [...okUppers]),
    ).toThrow(/malformed LOWER_TAIL/);
    expect(() =>
      assertCanonicalOpenTailSemantics(okTails, [...okLowers], [...okUppers.slice(0, 6), "9"]),
    ).toThrow(/malformed UPPER_TAIL/);
    expect(() =>
      assertCanonicalOpenTailSemantics(
        okTails,
        [...okLowers.slice(0, 2), null, ...okLowers.slice(3)],
        [...okUppers],
      ),
    ).toThrow(/malformed INTERIOR/);
  });
});
