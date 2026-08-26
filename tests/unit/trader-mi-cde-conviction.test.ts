import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { buildHypothesisSet } from "@/lib/trader/intelligence/hypothesis/build-hypothesis-set";
import { CONVICTION_SUSTAINED_CYCLES } from "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import { createEmptyHypothesisSessionState } from "@/lib/trader/intelligence/mi-core.types";
import { buildReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/build-reconstruction-snapshot";
import { cdeReasonCodes, type Bar } from "@/lib/trader/intelligence/types";
import { buildReplayFusedContext } from "@/lib/trader/market-data/replay-fused-context-builder";
import { buildMarketUnderstandingBridge } from "@/lib/trader/intelligence/market-understanding-bridge-v0";

function loadFixture() {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as {
    bars: Bar[];
    latestQuote: import("@/lib/trader/intelligence/types").Quote;
  };
}

describe("trader CDE conviction gate (PR-2)", () => {
  it("truthful health: DEGRADED fused context does not trap to PAPER_ONLY when miCore enabled", () => {
    const fixture = loadFixture();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      newId: () => "feature-set",
    });
    const fusedContext = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const degradedContext = { ...fusedContext, aggregateHealth: "DEGRADED" as const };
    const understanding = buildMarketUnderstandingBridge({
      fusedContext: degradedContext,
      features,
    });

    const withoutMi = buildMsvEnvelope({
      features,
      fusedContext: degradedContext,
      understanding,
      miCoreEnabled: false,
      newId: () => "msv-off",
    });

    const reconstruction = buildReconstructionSnapshot({
      bars1m: fixture.bars,
      evaluatedAt,
      fusedContext: degradedContext,
    });
    let sessionState = createEmptyHypothesisSessionState();
    let opportunity;
    for (let i = 0; i < CONVICTION_SUSTAINED_CYCLES; i++) {
      const result = buildHypothesisSet({
        reconstruction,
        understanding,
        evaluatedAt,
        sessionState,
      });
      sessionState = result.sessionState;
      opportunity = result.hypothesisSet.opportunity ?? undefined;
    }

    const withMi = buildMsvEnvelope({
      features,
      fusedContext: degradedContext,
      understanding,
      opportunity,
      miCoreEnabled: true,
      newId: () => "msv-on",
    });

    expect(withoutMi.derived.reasonCodes).toContain(cdeReasonCodes.fusedContextReduced);
    expect(withMi.derived.reasonCodes).toContain(cdeReasonCodes.truthfulHealthDegradedOk);
  });

  it("does not publish diagnostic heuristic hypotheses as an opportunity", () => {
    const fixture = loadFixture();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      newId: () => "feature-set",
    });
    const fusedContext = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const understanding = buildMarketUnderstandingBridge({ fusedContext, features });
    const reconstruction = buildReconstructionSnapshot({
      bars1m: fixture.bars,
      evaluatedAt,
      fusedContext,
    });

    const { hypothesisSet } = buildHypothesisSet({
      reconstruction,
      understanding,
      evaluatedAt,
      sessionState: createEmptyHypothesisSessionState(),
    });

    const msv = buildMsvEnvelope({
      features,
      fusedContext,
      understanding,
      opportunity: hypothesisSet.opportunity ?? undefined,
      miCoreEnabled: true,
      newId: () => "msv-derived",
    });

    expect(msv.derived.activeHypothesisType).toBeUndefined();
    expect(msv.derived.eligibleStrategyFamilies).toBeUndefined();
  });
});
