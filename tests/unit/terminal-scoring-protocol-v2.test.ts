import { describe, expect, it } from "vitest";
import { assertTerminalProbabilityVectorV2, multiclassBrierRewardV1 } from "@/lib/trader/research/benchmark/terminal-scoring-protocol-v2";
import { multiclassLogScore } from "@/lib/trader/research/benchmark/target-grid-ceremony-v1";

const grid = { bucketCount: 7 as const, edges: [-3, -2, -1, 0, 1, 2] };
const outcomes = [-4, -2.5, -1.5, -0.5, 0.5, 1.5, 3];
const oneHot = (j: number) => Array.from({ length: 7 }, (_, k) => j === k ? 1 : 0);

describe("DEE-992 frozen multiclass Brier reward", () => {
  it.each(outcomes.map((y, j) => ({ y, j })))("scores all seven categories, including open tails: $j", ({ y, j }) => {
    expect(multiclassBrierRewardV1(y, oneHot(j), grid)).toBe(0);
    expect(Object.is(multiclassBrierRewardV1(y, oneHot(j), grid), -0)).toBe(false);
    expect(multiclassBrierRewardV1(y, oneHot((j + 1) % 7), grid)).toBe(-2);
    expect(multiclassBrierRewardV1(y, Array(7).fill(1 / 7), grid)).toBeCloseTo(-6 / 7, 14);
    if (j < 6) expect(multiclassBrierRewardV1(grid.edges[j]!, oneHot(j), grid)).toBe(0);
  });

  it("retains both-zero log NaN as diagnostic while primary difference stays finite", () => {
    const p = oneHot(1), q = oneHot(2);
    expect(multiclassLogScore(-4, p, grid)).toBe(-Infinity);
    expect(multiclassLogScore(-4, p, grid) - multiclassLogScore(-4, q, grid)).toBeNaN();
    expect(multiclassBrierRewardV1(-4, p, grid) - multiclassBrierRewardV1(-4, q, grid)).toBe(0);
  });

  it("is strictly proper: truthful expected advantage equals squared distance on a deterministic simplex grid", () => {
    const vectors: number[][] = [];
    const enumerate = (prefix: number[], remaining: number): void => {
      if (prefix.length === 6) { vectors.push([...prefix, remaining].map(x => x / 4)); return; }
      for (let i = 0; i <= remaining; i++) enumerate([...prefix, i], remaining - i);
    };
    enumerate([], 4);
    expect(vectors).toHaveLength(210);
    for (const q of vectors) for (const p of vectors) {
      const advantage = outcomes.reduce((sum, y, j) => sum + q[j]! *
        (multiclassBrierRewardV1(y, q, grid) - multiclassBrierRewardV1(y, p, grid)), 0);
      expect(advantage).toBeCloseTo(q.reduce((sum, x, j) => sum + (x - p[j]!) ** 2, 0), 14);
    }
  });

  it.each([
    [], Array(6).fill(1 / 6), Array(8).fill(1 / 8), new Array<number>(7),
    [NaN, 0, 0, 0, 0, 0, 1], [Infinity, 0, 0, 0, 0, 0, 0],
    [-0.1, 0.1, 0, 0, 0, 0, 1], [1.1, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0], [1 - 2e-12, 0, 0, 0, 0, 0, 0],
  ].map(p => ({ p })))("rejects malformed probability vector %# without repair", ({ p }) => {
    expect(() => assertTerminalProbabilityVectorV2(p)).toThrow("TERMINAL_SCORE_INVALID_PROBABILITIES");
  });

  it("rejects accessor entries without invoking them", () => {
    const p = oneHot(1);
    Object.defineProperty(p, "0", { get() { throw new Error("must not execute"); } });
    expect(() => assertTerminalProbabilityVectorV2(p)).toThrow("TERMINAL_SCORE_INVALID_PROBABILITIES");
  });

  it("uses tolerance only as input validation, never normalization or mutation", () => {
    const p = Object.freeze([1 - 5e-13, 0, 0, 0, 0, 0, 0]);
    const before = [...p];
    expect(multiclassBrierRewardV1(-4, p, grid)).toBe(-((p[0]! - 1) ** 2));
    expect(p).toEqual(before);
  });

  it("rejects nonfinite outcomes and invalid grids without changing equal-edge semantics", () => {
    for (const y of [NaN, Infinity, -Infinity])
      expect(() => multiclassBrierRewardV1(y, oneHot(0), grid)).toThrow("TERMINAL_SCORE_INVALID_TARGET");
    for (const edges of [[], new Array<number>(6), [-3, -2, 1, 0, 1, 2], [-3, -2, -1, 0, 1, NaN]])
      expect(() => multiclassBrierRewardV1(0, oneHot(0), { ...grid, edges })).toThrow("TERMINAL_SCORE_INVALID_TARGET");
    expect(multiclassBrierRewardV1(0, oneHot(0), { ...grid, edges: Array(6).fill(0) })).toBe(0);
  });
});
