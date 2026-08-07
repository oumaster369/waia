/**
 * FHV STREAM_ONLY microbench — exercises composite evidence sink + STREAM_ONLY retention.
 * Usage:
 *   WAIA_TRADER_CLI=1 node --import tsx --conditions=react-server scripts/trader/fhv-stream-only-microbench.ts [cycles]
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runBacktest } from "@/lib/trader/backtest/backtest-runner";
import {
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
} from "@/lib/trader/execution/cost-model";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import type { Bar } from "@/lib/trader/intelligence/types";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import { createFhvCompositeEvidenceSink } from "@/lib/trader/observability/fhv-composite-evidence-sink";
import { seedFhvHistoricalExecutionSession } from "@/lib/trader/observability/fhv-historical-execution-session";
import { buildResearchValidationCycleIdPrefix } from "@/lib/trader/research/research-backtest-cycle-id";
import {
  createHtrInitialAccountRiskState,
  HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
} from "@/lib/trader/research/htr-initial-portfolio-contract";
import { buildResearchV2PortfolioContext } from "@/lib/trader/research/research-portfolio-config";

const DEFAULT_CYCLES = 500;
const ORG_ID = "00000000-0000-4000-8000-000000000436";
const OPERATOR_ID = "fhv-microbench-operator";
const RELEASE_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function flatBars(count: number): Bar[] {
  const bars: Bar[] = [];
  for (let index = 0; index < count; index += 1) {
    const openTime = new Date(
      Date.parse("2026-01-01T00:00:00.000Z") + index * 60_000,
    ).toISOString();
    const closeTime = new Date(Date.parse(openTime) + 60_000).toISOString();
    bars.push({
      symbol: "BTC/USDT",
      interval: "1m",
      barOpenTime: openTime,
      barCloseTime: closeTime,
      open: "65000.00",
      high: "65010.00",
      low: "64990.00",
      close: "65000.00",
      volume: "12.50",
    });
  }
  return bars;
}

async function main(): Promise<void> {
  const maxCycles = Number(process.argv[2] ?? DEFAULT_CYCLES);
  const runDir = mkdtempSync(join(tmpdir(), "fhv-stream-microbench-"));
  const runId = `fhv-microbench-${Date.now()}`;
  const costModel = costModelV1FromAuthority(createHtrHistoricalCostModelAuthorityV1());
  const portfolio = buildResearchV2PortfolioContext(costModel);
  const accountKey = "fhv-stream-microbench";
  const { session, context, cleanup } = await seedFhvHistoricalExecutionSession({
    organizationId: ORG_ID,
    operatorId: OPERATOR_ID,
    slot: 436,
  });
  const cycleIdPrefix = buildResearchValidationCycleIdPrefix(runId);
  const bars = flatBars(maxCycles + 30);
  const compositeEvidenceSink = createFhvCompositeEvidenceSink({
    runDir,
    runId,
    gitSha: RELEASE_SHA,
    environment: "fhv-stream-microbench",
    epochId: 0,
    generation: 1,
    runLogRoot: join(runDir, "fhv-trace"),
    organizationId: ORG_ID,
    accountKey,
    provenance: {
      codeSha: RELEASE_SHA,
      dirtyTree: false,
      datasetManifestDigest: "c".repeat(64),
      runConfigDigest: "d".repeat(64),
      strategyVersions: [`${MEAN_REVERSION_V0}@0.1.0`],
      costModelVersion: "waia.trader.historical-execution-model.v1",
      riskPolicyVersion: "htr-wp16-d20-drawdown/v1",
      initialPortfolioDigest: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
    },
  });

  const started = performance.now();
  const result = await runBacktest({
    context,
    barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix }),
    deps: session.deps,
    orderRepository: session.orderRepository,
    accountKey,
    defaultQuantity: "0.01",
    costModel,
    portfolio,
    strategySignalIds: [MEAN_REVERSION_V0],
    strategyId: MEAN_REVERSION_V0,
    strategyVersion: "0.1.0",
    regimeLabel: "AGGREGATE",
    datasetId: "fhv-stream-microbench",
    runId,
    split: "validation",
    window: {
      start: new Date(bars[0]!.barOpenTime),
      end: new Date(bars.at(-1)!.barCloseTime),
    },
    accountState: createHtrInitialAccountRiskState(),
    exportedAt: new Date(bars.at(-1)!.barCloseTime),
    retentionMode: "STREAM_ONLY",
    evidenceSink: compositeEvidenceSink,
    maxCycles,
    enableReplayFusedContext: false,
    historicalExecutionProfile: session.historicalExecutionProfile,
    historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
    wp16: {
      runId,
      portfolioId: accountKey,
      historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
    },
    checkpointRunRoot: runDir,
    telemetrySink: () => {},
  });
  const elapsedMs = performance.now() - started;
  const cyclesPerSec = (result.cycleCount / elapsedMs) * 1000;

  console.log(
    JSON.stringify(
      {
        mode: "STREAM_ONLY",
        maxCycles,
        completedCycles: result.cycleCount,
        elapsedMs: Math.round(elapsedMs),
        cyclesPerSec: Number(cyclesPerSec.toFixed(2)),
        peakBufferedProjections: compositeEvidenceSink.peakBufferedProjections(),
        evidenceDigest: result.evidenceDigest.slice(0, 16),
      },
      null,
      2,
    ),
  );

  cleanup();
  rmSync(runDir, { recursive: true, force: true });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
