import { describe, expect, it } from "vitest";

import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import {
  buildM9MarketUnderstandingSampleExport,
  M9_MARKET_UNDERSTANDING_SAMPLE_SCHEMA_VERSION,
} from "@/lib/trader/research/m9-market-understanding-export";
import { buildReplayFusedContext } from "@/lib/trader/market-data/replay-fused-context-builder";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";

function makeCycleResult(input: {
  bars: import("@/lib/trader/intelligence/types").Bar[];
  quote: import("@/lib/trader/intelligence/types").Quote;
  organizationId: string;
}): PaperCycleResult {
  const evaluatedAt = input.bars.at(-1)!.barCloseTime;
  const fusedContext = buildReplayFusedContext({
    bars: input.bars,
    quote: input.quote,
    evaluatedAt,
    instrumentId: "BTC/USDT",
  });
  const evaluation = runEvaluationCycle({
    organizationId: input.organizationId,
    bars: input.bars,
    quote: input.quote,
    evaluatedAt,
    fusedContext,
    newId: () => "test-id",
  });

  return {
    evaluation,
    strategyExecutions: [],
    submitBlocked: true,
    skipReason: "no_signal",
    execution: null,
    reconciliation: null,
  };
}

describe("PR2.6 M9 market understanding export", () => {
  it("exports understanding snapshots and research signals", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const fixturePath = path.join(
      process.cwd(),
      "tests/fixtures/trader/btcusdt-1m-mean-reversion.json",
    );
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      bars: import("@/lib/trader/intelligence/types").Bar[];
      latestQuote: import("@/lib/trader/intelligence/types").Quote;
    };

    const cycleResults = [
      makeCycleResult({
        bars: fixture.bars,
        quote: fixture.latestQuote,
        organizationId: "00000000-0000-4000-8000-0000000280",
      }),
    ];

    const exported = buildM9MarketUnderstandingSampleExport({
      organizationId: "00000000-0000-4000-8000-0000000280",
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      cycleResults,
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(exported.schemaVersion).toBe(M9_MARKET_UNDERSTANDING_SAMPLE_SCHEMA_VERSION);
    expect(exported.cyclesWithUnderstanding).toBe(1);
    expect(exported.understandingSnapshots).toHaveLength(1);
    expect(exported.researchSignals).toHaveLength(1);
    expect(exported.understandingSnapshots[0]!.questionEvaluations).toHaveLength(11);
  });
});
