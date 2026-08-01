import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { runBacktest, type RunBacktestResult } from "@/lib/trader/backtest/backtest-runner";
import { createStreamingEvidenceSink } from "@/lib/trader/backtest/streaming-evidence";
import {
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
} from "@/lib/trader/execution/cost-model";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import type { Bar } from "@/lib/trader/intelligence/types";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import { FhvSharedPortfolioBarReplaySource } from "@/lib/trader/market-data/fhv-shared-portfolio-bar-replay-source";
import type { BarReplaySource } from "@/lib/trader/market-data/types";
import type { FhvConfigurationFreezeV1 } from "@/lib/trader/observability/fhv-configuration-freeze";
import { seedFhvHistoricalExecutionSession } from "@/lib/trader/observability/fhv-historical-execution-session";
import { buildResearchValidationCycleIdPrefix } from "@/lib/trader/research/research-backtest-cycle-id";
import { createHtrInitialAccountRiskState } from "@/lib/trader/research/htr-initial-portfolio-contract";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";
import { buildResearchV2PortfolioContext } from "@/lib/trader/research/research-portfolio-config";

function parseStrategyBinding(version: string): { strategyId: string; strategyVersion: string } {
  const at = version.lastIndexOf("@");
  if (at <= 0 || at >= version.length - 1) {
    throw new Error(`Invalid strategy binding: ${version}`);
  }
  return {
    strategyId: version.slice(0, at),
    strategyVersion: version.slice(at + 1),
  };
}

function resolveStrategyBindings(configurationFreeze: FhvConfigurationFreezeV1): {
  strategySignalIds: string[];
  primaryStrategyId: string;
  primaryStrategyVersion: string;
} {
  const bindings = configurationFreeze.strategyVersions.map(parseStrategyBinding);
  return {
    strategySignalIds: bindings.map((binding) => binding.strategyId),
    primaryStrategyId: bindings[0]!.strategyId,
    primaryStrategyVersion: bindings[0]!.strategyVersion,
  };
}

function createBenchmarkNewIdFactory(): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(436000 + sequence).padStart(12, "0")}`;
  };
}

export async function runFullHistoricalBacktest(input: {
  runDir: string;
  runId: string;
  releaseSha: string;
  organizationId: string;
  operatorId: string;
  configurationFreeze: FhvConfigurationFreezeV1;
  bars: readonly Bar[];
  boundedFixture: boolean;
  includeHoldout: boolean;
  maxCycles?: number;
}): Promise<RunBacktestResult> {
  const costModel = costModelV1FromAuthority(createHtrHistoricalCostModelAuthorityV1());
  const portfolio = buildResearchV2PortfolioContext(costModel);
  const accountKey = "fhv-full-historical";
  const { session, context, cleanup } = await seedFhvHistoricalExecutionSession({
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    slot: 436,
  });
  mkdirSync(input.runDir, { recursive: true });
  const evidenceSink = createStreamingEvidenceSink({
    runDir: input.runDir,
    runId: input.runId,
    gitSha: input.releaseSha,
    environment: input.boundedFixture
      ? "fhv-full-historical-bounded"
      : "fhv-full-historical-official",
  });
  const window = {
    start: new Date(input.bars[0]!.barOpenTime),
    end: new Date(input.bars.at(-1)!.barCloseTime),
  };
  const cycleIdPrefix = buildResearchValidationCycleIdPrefix(input.runId);
  const barSource: BarReplaySource = input.boundedFixture
    ? new HistoricalBarReplaySource({ bars: input.bars, cycleIdPrefix })
    : new FhvSharedPortfolioBarReplaySource(input.bars, cycleIdPrefix);
  const strategies = resolveStrategyBindings(input.configurationFreeze);
  const accountState = createHtrInitialAccountRiskState();

  try {
    return await runBacktest({
      context,
      barSource,
      deps: session.deps,
      orderRepository: session.orderRepository,
      accountKey,
      defaultQuantity: "0.01",
      costModel,
      portfolio,
      strategySignalIds: strategies.strategySignalIds,
      strategyId: strategies.primaryStrategyId,
      strategyVersion: strategies.primaryStrategyVersion,
      regimeLabel: "AGGREGATE",
      datasetId: input.boundedFixture
        ? "fhv-full-historical-bounded"
        : "fhv-full-historical-official",
      runId: input.runId,
      split: input.includeHoldout ? "blind" : "validation",
      window,
      accountState,
      exportedAt: new Date(window.end),
      activeStrategyIds: strategies.strategySignalIds,
      newId: createBenchmarkNewIdFactory(),
      retentionMode: "STREAM_ONLY",
      evidenceSink,
      maxCycles: input.maxCycles ?? (input.boundedFixture ? 20 : undefined),
      enableReplayFusedContext: false,
      historicalExecutionProfile: session.historicalExecutionProfile,
      historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
      wp16: {
        runId: input.runId,
        portfolioId: accountKey,
        historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
      },
      checkpointRunRoot: input.runDir,
      fhvObservability: {
        runLogRoot: join(input.runDir, "fhv-trace"),
        provenance: {
          codeSha: input.releaseSha,
          dirtyTree: false,
          datasetManifestDigest: input.configurationFreeze.manifestDigest,
          runConfigDigest: input.configurationFreeze.configurationFreezeDigest,
          strategyVersions: [...input.configurationFreeze.strategyVersions],
          costModelVersion: "waia.trader.historical-execution-model.v1",
          riskPolicyVersion: input.configurationFreeze.drawdownPolicyVersion,
          initialPortfolioDigest: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
        },
      },
    });
  } finally {
    cleanup();
  }
}
