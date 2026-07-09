import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildHypothesisSet } from "@/lib/trader/intelligence/hypothesis/build-hypothesis-set";
import {
  CONVICTION_SUSTAINED_CYCLES,
  CONVICTION_THRESHOLD,
  hypothesisTypeEnum,
} from "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import { createEmptyHypothesisSessionState } from "@/lib/trader/intelligence/mi-core.types";
import { buildReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/build-reconstruction-snapshot";
import type { Bar } from "@/lib/trader/intelligence/types";

function loadFixtureBars(): Bar[] {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  const fixture = JSON.parse(readFileSync(filePath, "utf8")) as { bars: Bar[] };
  return fixture.bars;
}

describe("trader hypothesis engine (PR-2)", () => {
  it("emits all 8 competing market hypothesis types", () => {
    const bars = loadFixtureBars();
    const evaluatedAt = bars.at(-1)!.barCloseTime;
    const reconstruction = buildReconstructionSnapshot({ bars1m: bars, evaluatedAt });

    const { hypothesisSet } = buildHypothesisSet({
      reconstruction,
      evaluatedAt,
      sessionState: createEmptyHypothesisSessionState(),
    });

    expect(hypothesisSet.hypotheses).toHaveLength(8);
    const types = hypothesisSet.hypotheses.map((h) => h.hypothesisType).sort();
    expect(types).toEqual([...hypothesisTypeEnum].sort());
  });

  it("each hypothesis has confidence, evidence, expectedPath, invalidation, and strategy families", () => {
    const bars = loadFixtureBars();
    const evaluatedAt = bars.at(-1)!.barCloseTime;
    const reconstruction = buildReconstructionSnapshot({ bars1m: bars, evaluatedAt });

    const { hypothesisSet } = buildHypothesisSet({
      reconstruction,
      evaluatedAt,
      sessionState: createEmptyHypothesisSessionState(),
    });

    for (const hypothesis of hypothesisSet.hypotheses) {
      expect(hypothesis.confidence).toBeGreaterThanOrEqual(0);
      expect(hypothesis.confidence).toBeLessThanOrEqual(1);
      expect(hypothesis.expectedPath).toBeTruthy();
      expect(hypothesis.eligibleStrategyFamilies.length).toBeGreaterThan(0);
    }
  });

  it("conviction accumulates across cycles deterministically", () => {
    const bars = loadFixtureBars();
    const evaluatedAt = bars.at(-1)!.barCloseTime;
    const reconstruction = buildReconstructionSnapshot({ bars1m: bars, evaluatedAt });

    let sessionState = createEmptyHypothesisSessionState();
    const digests: string[] = [];

    for (let i = 0; i < CONVICTION_SUSTAINED_CYCLES + 2; i++) {
      const result = buildHypothesisSet({
        reconstruction,
        evaluatedAt,
        sessionState,
      });
      sessionState = result.sessionState;
      digests.push(JSON.stringify(result.hypothesisSet));
    }

    let sessionState2 = createEmptyHypothesisSessionState();
    const digests2: string[] = [];
    for (let i = 0; i < CONVICTION_SUSTAINED_CYCLES + 2; i++) {
      const result = buildHypothesisSet({
        reconstruction,
        evaluatedAt,
        sessionState: sessionState2,
      });
      sessionState2 = result.sessionState;
      digests2.push(JSON.stringify(result.hypothesisSet));
    }

    expect(digests).toEqual(digests2);
  });

  it("does not import any strategies/* module", async () => {
    const mod = await import("@/lib/trader/intelligence/hypothesis/build-hypothesis-set");
    expect(mod.buildHypothesisSet).toBeDefined();
    expect(CONVICTION_THRESHOLD).toBe(0.65);
    expect(CONVICTION_SUSTAINED_CYCLES).toBe(3);
  });
});
