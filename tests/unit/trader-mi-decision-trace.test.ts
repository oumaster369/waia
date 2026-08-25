import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import {
  defineMarketUnderstandingArtifactV1,
  defineUnderstandingClaimV1,
} from "@/lib/trader/intelligence/market-understanding-evidence-attribution-v1";
import { CANONICAL_MARKET_QUESTION_IDS } from "@/lib/trader/intelligence/market-understanding.types";
import { buildM9DecisionTraceExport } from "@/lib/trader/research/m9-decision-trace-export";
import type { Bar, Quote } from "@/lib/trader/intelligence/types";
import { buildReplayFusedContext } from "@/lib/trader/market-data/replay-fused-context-builder";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import {
  makeUnderstandingProfileReceipt,
  understandingTestDigest,
} from "@/tests/unit/helpers/market-understanding-evidence";

function makeUnderstandingArtifact() {
  const fixture = makeUnderstandingProfileReceipt();
  return defineMarketUnderstandingArtifactV1({
    ...fixture,
    evaluatedAt: fixture.receipt.pitAnchor,
    claims: CANONICAL_MARKET_QUESTION_IDS.map((marketQuestionId) => {
      const whatQuestion = marketQuestionId === "Q_WHAT_HAPPENING";
      const capitalQuestion =
        marketQuestionId === "Q_DEPLOY_CAPITAL" || marketQuestionId === "Q_PRESERVE_CAPITAL";
      return defineUnderstandingClaimV1({
        profile: fixture.profile,
        receipt: fixture.receipt,
        computationInputs: [
          {
            path: `question.${marketQuestionId.toLowerCase()}`,
            contentDigest: understandingTestDigest(`trace:${marketQuestionId}`),
          },
        ],
        marketQuestionId,
        claimState: whatQuestion
          ? "SUPPORTED"
          : capitalQuestion
            ? "NOT_APPLICABLE"
            : "UNAVAILABLE",
        claimKind: whatQuestion ? "OBSERVED_FACT" : "UNRESOLVED",
        answerSummary: whatQuestion
          ? "exact_price_state"
          : capitalQuestion
            ? "outside_market_understanding_authority"
            : "question_receipt_unavailable",
        consumedEvidence: whatQuestion
          ? [
              {
                evidenceId: "evidence-price-1",
                role: "SUPPORTING" as const,
                dependencyPaths: ["question.q_what_happening"],
              },
            ]
          : [],
      });
    }),
  });
}

function loadFixture() {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as { bars: Bar[]; latestQuote: Quote };
}

function runCycles(n: number): PaperCycleResult[] {
  const fixture = loadFixture();
  const results: PaperCycleResult[] = [];
  let hypothesisSessionState;

  for (let i = 0; i < n; i++) {
    const bars = fixture.bars.slice(0, Math.min(fixture.bars.length, 20 + i * 5));
    const evaluatedAt = bars.at(-1)!.barCloseTime;
    const fusedContext = buildReplayFusedContext({
      bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const evaluation = runEvaluationCycle({
      organizationId: "org-test",
      bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      fusedContext,
      miCoreEnabled: true,
      hypothesisSessionState,
      newId: () => `cycle-${i}`,
    });
    hypothesisSessionState = evaluation.hypothesisSessionState;
    results.push({
      evaluation,
      strategyExecutions: [],
      submitBlocked: true,
      execution: null,
      reconciliation: null,
    });
  }
  return results;
}

describe("m9 decision trace MI core completeness (PR-2)", () => {
  it("exports 100% decision-chain completeness when MI core enabled", () => {
    const cycleResults = runCycles(5);
    const trace = buildM9DecisionTraceExport({
      organizationId: "org-test",
      strategyId: "liquidity_sweep_reversal_v0",
      strategyVersion: "0.1.0",
      cycleResults,
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(trace.completenessCoverage).toBe("full");
    expect(trace.totalInputCycles).toBe(5);
    expect(trace.cycleCount).toBe(5);
    for (const cycle of trace.cycles) {
      expect(cycle.decisionChain?.terminalReasonCode).toBeTruthy();
      expect(cycle.decisionChain?.observation.terminalReasonCode).toBeTruthy();
      expect(cycle.decisionChain?.observation.expectedPath).toBeTruthy();
    }
  });

  it("content digest is deterministic excluding generatedAt", () => {
    const cycleResults = runCycles(3);
    cycleResults[0]!.evaluation.understandingArtifact = makeUnderstandingArtifact();
    const base = {
      organizationId: "org-test",
      strategyId: "liquidity_sweep_reversal_v0",
      strategyVersion: "0.1.0",
      cycleResults,
      generatedAt: "2026-01-01T00:00:00.000Z",
    };
    const first = buildM9DecisionTraceExport(base);
    const second = buildM9DecisionTraceExport(base);
    expect(first.contentDigest).toBe(second.contentDigest);
    expect(first.cycles[0]!.understandingArtifact).toMatchObject({
      understandingContentDigest:
        cycleResults[0]!.evaluation.understandingArtifact?.contentDigest,
      authority: {
        kind: "MARKET_UNDERSTANDING_ONLY",
        createsForecastAuthority: false,
        createsDecisionAuthority: false,
        createsRiskAuthority: false,
        createsExecutionAuthority: false,
        createsCapitalAuthority: false,
      },
    });
    expect(
      first.cycles[0]!.understandingArtifact?.questionLineage.find(
        (claim) => claim.marketQuestionId === "Q_WHAT_HAPPENING",
      ),
    ).toMatchObject({
      claimState: "SUPPORTED",
      claimKind: "OBSERVED_FACT",
      evidenceDependencies: [
        expect.objectContaining({
          disposition: "CONSUMED",
          role: "SUPPORTING",
          evidence: expect.objectContaining({ evidenceId: "evidence-price-1" }),
        }),
      ],
    });
  });
});
