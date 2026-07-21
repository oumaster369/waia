import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  loadApprovedBenchmarkFixture,
  readGitCodeSha,
  seedBenchmarkSession,
} from "@/lib/trader/backtest/replay-benchmark-harness";
import { runBacktest, type RunBacktestResult } from "@/lib/trader/backtest/backtest-runner";
import { createStreamingEvidenceSink } from "@/lib/trader/backtest/streaming-evidence";
import {
  computeSemanticParityDigest,
  readSegmentProjections,
} from "@/lib/trader/backtest/streaming-evidence/replay-run-chain-reader";
import {
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
} from "@/lib/trader/execution/cost-model";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import { buildAndWriteFhvOperatorStatus } from "@/lib/trader/observability/fhv-status-writer";
import { computeReplayReproContentDigest } from "@/lib/trader/research/replay-repro-digest";
import { buildResearchValidationCycleIdPrefix } from "@/lib/trader/research/research-backtest-cycle-id";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";

const BENCHMARK_STRATEGY_VERSION = "0.1.0";

export type FhvEconomicDigestBundle = Readonly<{
  decisionDigest: string;
  orderDigest: string;
  fillDigest: string;
  accountingDigest: string;
  pnlDigest: string;
  terminalState: string;
}>;

export type FhvEconomicNonInterferenceResult = Readonly<{
  terminalEvidence: "PASS-FHV-ECONOMIC-NON-INTERFERENCE" | "FAIL-FHV-ECONOMIC-NON-INTERFERENCE";
  baseline: FhvEconomicDigestBundle;
  instrumented: FhvEconomicDigestBundle;
  parity: Readonly<Record<keyof FhvEconomicDigestBundle, boolean>>;
  passed: boolean;
}>;

function createBenchmarkNewIdFactory(): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(416900 + sequence).padStart(12, "0")}`;
  };
}

function computePnlDigest(backtest: RunBacktestResult): string {
  const report = backtest.htrPnlReportV1 ?? backtest.exportBundle.htrPnlReportV1;
  if (report) {
    return computeSemanticSha256Hex({
      grossRealizedPnlUsdt: report.grossRealizedPnlUsdt,
      netRealizedPnlUsdt: report.netRealizedPnlUsdt,
      netUnrealizedPnlUsdt: report.netUnrealizedPnlUsdt,
      totalExecutionCostUsdt: report.totalExecutionCostUsdt,
      terminalCashUsdt: report.terminalCashUsdt,
    });
  }
  return computeSemanticSha256Hex({
    terminalState: backtest.cycleCount > 0 ? "REPLAY_RUN_OK" : "REPLAY_RUN_EMPTY",
  });
}

function computeFhvEconomicDigestBundle(input: {
  backtest: RunBacktestResult;
  runDir: string;
}): FhvEconomicDigestBundle {
  const projections = readSegmentProjections(input.runDir);
  const decisionDigest = computeSemanticParityDigest(projections);
  const orderDigest = computeSemanticSha256Hex(
    input.backtest.exportBundle.strategyEvaluations.map((entry) => ({
      strategySignalId: entry.strategySignalId,
      closedTradeCount: entry.closedTradeCount,
    })),
  );
  const fillDigest = computeSemanticSha256Hex(
    input.backtest.accountingFrontierState?.consumedFillIds ?? [],
  );
  const accountingDigest = computeSemanticSha256Hex(
    input.backtest.accountingFrontierState ?? input.backtest.accountingState ?? {},
  );
  const pnlDigest = computePnlDigest(input.backtest);
  return {
    decisionDigest,
    orderDigest,
    fillDigest,
    accountingDigest,
    pnlDigest,
    terminalState: input.backtest.cycleCount > 0 ? "REPLAY_RUN_OK" : "REPLAY_RUN_EMPTY",
  };
}

async function runBenchmarkPass(input: {
  runDir: string;
  runId: string;
  observabilityEnabled: boolean;
}): Promise<{ backtest: RunBacktestResult; digests: FhvEconomicDigestBundle }> {
  const fixture = loadApprovedBenchmarkFixture();
  const { session, context } = await seedBenchmarkSession();
  mkdirSync(input.runDir, { recursive: true });
  const evidenceSink = createStreamingEvidenceSink({
    runDir: input.runDir,
    runId: input.runId,
    gitSha: readGitCodeSha(),
    environment: "fhv-economic-non-interference",
  });
  const window = {
    start: new Date(fixture.bars[0]!.barOpenTime),
    end: new Date(fixture.bars.at(-1)!.barCloseTime),
  };
  const cycleIdPrefix = buildResearchValidationCycleIdPrefix(input.runId);
  const barSource = new HistoricalBarReplaySource({
    bars: fixture.bars,
    quote: fixture.latestQuote,
    cycleIdPrefix,
  });

  try {
    const backtest = await runBacktest({
      context,
      barSource,
      deps: session.deps,
      orderRepository: session.orderRepository,
      accountKey: "fhv-economic-non-interference",
      defaultQuantity: "0.01",
      costModel: costModelV1FromAuthority(createHtrHistoricalCostModelAuthorityV1()),
      strategySignalIds: [MEAN_REVERSION_V0],
      strategyId: MEAN_REVERSION_V0,
      strategyVersion: BENCHMARK_STRATEGY_VERSION,
      regimeLabel: "AGGREGATE",
      datasetId: "fhv-economic-non-interference",
      runId: input.runId,
      split: "validation",
      window,
      accountState: {
        positions: [],
        openOrderCount: 0,
        dailyPnl: "0",
        drawdown: "0",
        quoteExposureByCurrency: {},
      },
      exportedAt: new Date(window.end),
      activeStrategyIds: [MEAN_REVERSION_V0],
      newId: createBenchmarkNewIdFactory(),
      retentionMode: "STREAM_ONLY",
      evidenceSink,
      maxCycles: 20,
      fhvObservability: input.observabilityEnabled
        ? {
            runLogRoot: join(input.runDir, "fhv-trace"),
            provenance: {
              codeSha: readGitCodeSha(),
              dirtyTree: false,
              datasetManifestDigest: "fhv-economic-non-interference",
              runConfigDigest: computeSemanticSha256Hex({ runId: input.runId }),
              strategyVersions: [`${MEAN_REVERSION_V0}@${BENCHMARK_STRATEGY_VERSION}`],
              costModelVersion: "htr-historical-cost-model/v1",
              riskPolicyVersion: "htr-wp16-d20-drawdown/v1",
              initialPortfolioDigest: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
            },
          }
        : undefined,
    });

    if (input.observabilityEnabled) {
      buildAndWriteFhvOperatorStatus(join(input.runDir, "observer"), {
        runId: input.runId,
        phase: "validation",
        codeSha: readGitCodeSha(),
        artifactDigest: backtest.evidenceDigest,
        datasetSeal: "fhv-economic-non-interference",
        datasetDigest: "fhv-economic-non-interference",
        configurationDigest: backtest.evidenceDigest,
        barsProcessed: backtest.cycleCount,
        barsTotal: backtest.cycleCount,
        terminalState: "REPLAY_RUN_OK",
      });
    }

    return {
      backtest,
      digests: computeFhvEconomicDigestBundle({ backtest, runDir: input.runDir }),
    };
  } finally {
    session.cleanup();
  }
}

export async function runFhvEconomicNonInterferenceQualification(): Promise<FhvEconomicNonInterferenceResult> {
  const root = mkdtempSync(join(tmpdir(), "fhv-economic-non-interference-"));
  try {
    const baselineDir = join(root, "baseline");
    const instrumentedDir = join(root, "instrumented");
    const baseline = await runBenchmarkPass({
      runDir: baselineDir,
      runId: "fhv-econ-baseline",
      observabilityEnabled: false,
    });
    const instrumented = await runBenchmarkPass({
      runDir: instrumentedDir,
      runId: "fhv-econ-instrumented",
      observabilityEnabled: true,
    });

    const parity = {
      decisionDigest: baseline.digests.decisionDigest === instrumented.digests.decisionDigest,
      orderDigest: baseline.digests.orderDigest === instrumented.digests.orderDigest,
      fillDigest: baseline.digests.fillDigest === instrumented.digests.fillDigest,
      accountingDigest: baseline.digests.accountingDigest === instrumented.digests.accountingDigest,
      pnlDigest: baseline.digests.pnlDigest === instrumented.digests.pnlDigest,
      terminalState: baseline.digests.terminalState === instrumented.digests.terminalState,
    };
    const passed = Object.values(parity).every(Boolean);
    return {
      terminalEvidence: passed
        ? "PASS-FHV-ECONOMIC-NON-INTERFERENCE"
        : "FAIL-FHV-ECONOMIC-NON-INTERFERENCE",
      baseline: baseline.digests,
      instrumented: instrumented.digests,
      parity,
      passed,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
