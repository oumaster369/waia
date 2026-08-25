import { describe, expect, it } from "vitest";

import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import {
  defineMarketUnderstandingArtifactV1,
  defineUnderstandingClaimV1,
} from "@/lib/trader/intelligence/market-understanding-evidence-attribution-v1";
import { CANONICAL_MARKET_QUESTION_IDS } from "@/lib/trader/intelligence/market-understanding.types";
import {
  buildM9MarketUnderstandingSampleExport,
  M9_MARKET_UNDERSTANDING_SAMPLE_SCHEMA_VERSION,
} from "@/lib/trader/research/m9-market-understanding-export";
import { buildReplayFusedContext } from "@/lib/trader/market-data/replay-fused-context-builder";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import {
  makeUnderstandingProfileReceipt,
  understandingTestDigest,
} from "@/tests/unit/helpers/market-understanding-evidence";

function makeUnderstandingArtifact() {
  const fixture = makeUnderstandingProfileReceipt();
  const claims = CANONICAL_MARKET_QUESTION_IDS.map((marketQuestionId) => {
    const capitalQuestion =
      marketQuestionId === "Q_DEPLOY_CAPITAL" || marketQuestionId === "Q_PRESERVE_CAPITAL";
    return defineUnderstandingClaimV1({
      profile: fixture.profile,
      receipt: fixture.receipt,
      computationInputs: [
        {
          path: `question.${marketQuestionId.toLowerCase()}`,
          contentDigest: understandingTestDigest(`m9:${marketQuestionId}`),
        },
      ],
      marketQuestionId,
      claimState:
        marketQuestionId === "Q_WHAT_HAPPENING"
          ? "SUPPORTED"
          : capitalQuestion
            ? "NOT_APPLICABLE"
            : "UNAVAILABLE",
      claimKind: marketQuestionId === "Q_WHAT_HAPPENING" ? "OBSERVED_FACT" : "UNRESOLVED",
      answerSummary:
        marketQuestionId === "Q_WHAT_HAPPENING"
          ? "exact_price_state"
          : capitalQuestion
            ? "outside_market_understanding_authority"
            : "question_receipt_unavailable",
      consumedEvidence:
        marketQuestionId === "Q_WHAT_HAPPENING"
          ? [
              {
                evidenceId: "evidence-price-1",
                role: "SUPPORTING" as const,
                dependencyPaths: ["question.q_what_happening"],
              },
            ]
          : [],
    });
  });
  return defineMarketUnderstandingArtifactV1({
    ...fixture,
    evaluatedAt: fixture.receipt.pitAnchor,
    claims,
  });
}

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
    cycleResults[0]!.evaluation.understandingArtifact = makeUnderstandingArtifact();

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
    expect(exported.understandingSnapshots[0]!.questionEvaluations).toHaveLength(12);
    expect(exported.cyclesWithUnderstandingArtifact).toBe(1);
    expect(exported.understandingArtifactIdentities).toHaveLength(1);
    const identity = exported.understandingArtifactIdentities[0]!;
    expect(identity.questionLineage).toHaveLength(12);
    expect(identity.derivationDefinitionContentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.authority.createsDecisionAuthority).toBe(false);
    expect(
      identity.questionLineage
        .find((claim) => claim.marketQuestionId === "Q_WHAT_HAPPENING")
        ?.evidenceDependencies.find((dependency) => dependency.disposition === "CONSUMED"),
    ).toMatchObject({
      role: "SUPPORTING",
      evidence: {
        evidenceId: "evidence-price-1",
        observationKind: "ohlcv_bar",
        sourceId: "00000000-0000-4000-8000-000000000001",
        observationId: "00000000-0000-4000-8000-000000000002",
      },
    });
  });
});
