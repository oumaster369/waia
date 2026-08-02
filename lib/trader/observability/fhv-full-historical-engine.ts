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
import { FhvOfficialDatasetReader } from "@/lib/trader/market-data/fhv-official-dataset-reader";
import type { FhvQualificationMode } from "@/lib/trader/observability/fhv-dataset-qualification";
import { assertFhvOfficialV2DatasetArtifactsPresent } from "@/lib/trader/market-data/fhv-official-v2-required";
import type { BarReplaySource } from "@/lib/trader/market-data/types";
import type { FhvConfigurationFreezeV1 } from "@/lib/trader/observability/fhv-configuration-freeze";
import {
  createFhvEpochBoundaryController,
  type FhvExecutionCheckpointConfig,
} from "@/lib/trader/observability/fhv-execution-checkpoint";
import type { FhvAuthorizationClaimV2 } from "@/lib/trader/observability/fhv-authorization-claim";
import type { FhvExecutionWalWriter } from "@/lib/trader/observability/fhv-execution-wal";
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
  bars?: readonly Bar[];
  datasetRoot?: string;
  qualificationMode?: FhvQualificationMode;
  boundedFixture: boolean;
  includeHoldout: boolean;
  controlReplay?: boolean;
  maxCycles?: number;
  walWriter?: FhvExecutionWalWriter;
  authorizationClaim?: FhvAuthorizationClaimV2;
  claimPath?: string;
  checkpointConfig?: FhvExecutionCheckpointConfig;
  resumeFromCycle?: number;
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
  const window = input.bars
    ? {
        start: new Date(input.bars[0]!.barOpenTime),
        end: new Date(input.bars.at(-1)!.barCloseTime),
      }
    : {
        start: new Date("2020-01-01T00:00:00.000Z"),
        end: new Date(
          input.includeHoldout ? "2026-01-01T00:00:00.000Z" : "2025-01-01T00:00:00.000Z",
        ),
      };
  const cycleIdPrefix = buildResearchValidationCycleIdPrefix(input.runId);
  let barSource: BarReplaySource;
  let officialReader: FhvOfficialDatasetReader | undefined;
  if (input.boundedFixture) {
    if (!input.bars) {
      throw new Error("[fhv] bounded fixture requires bars");
    }
    barSource = new HistoricalBarReplaySource({ bars: input.bars, cycleIdPrefix });
  } else if (input.qualificationMode === "OFFICIAL_MULTI_YEAR") {
    if (!input.datasetRoot) {
      throw new Error("[fhv] OFFICIAL_MULTI_YEAR requires sealed v2 datasetRoot");
    }
    assertFhvOfficialV2DatasetArtifactsPresent({
      datasetRoot: input.datasetRoot,
      qualificationMode: input.qualificationMode,
    });
    officialReader = new FhvOfficialDatasetReader({
      datasetRoot: input.datasetRoot,
      accessPurpose: input.controlReplay ? "CONTROL_REPLAY_STRATEGY" : "FULL_VALIDATION_STRATEGY",
      includeHoldoutStrategy: input.includeHoldout,
      includeHoldoutPartitions: input.includeHoldout,
      cycleIdPrefix,
    });
    barSource = officialReader;
  } else if (input.qualificationMode === "SCHEMA_INTEGRATION_FIXTURE") {
    if (!input.bars) {
      throw new Error("[fhv] SCHEMA_INTEGRATION_FIXTURE requires eager bars");
    }
    barSource = new FhvSharedPortfolioBarReplaySource(input.bars, cycleIdPrefix);
  } else {
    throw new Error(
      `[fhv] unsupported qualification mode for engine: ${String(input.qualificationMode)}`,
    );
  }
  const strategies = resolveStrategyBindings(input.configurationFreeze);
  const accountState = createHtrInitialAccountRiskState();

  const epochController =
    input.walWriter && input.authorizationClaim && input.claimPath && input.checkpointConfig
      ? createFhvEpochBoundaryController({
          runDir: input.runDir,
          runId: input.runId,
          claimPath: input.claimPath,
          walWriter: input.walWriter,
          authorizationClaim: input.authorizationClaim,
          checkpointConfig: input.checkpointConfig,
          sourceCursorDigest: input.configurationFreeze.manifestDigest,
          resumeFromCycle: input.resumeFromCycle,
        })
      : undefined;
  epochController?.beginInitialEpoch();

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
      retentionMode: input.boundedFixture ? undefined : "STREAM_ONLY",
      evidenceSink,
      maxCycles: input.maxCycles ?? (input.boundedFixture ? 20 : undefined),
      enableReplayFusedContext: false,
      resumeCycleStartIndex:
        input.resumeFromCycle && input.resumeFromCycle > 0 ? input.resumeFromCycle : undefined,
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
      ...(epochController ? { onCycleBoundary: epochController.onCycleBoundary } : {}),
    });
  } finally {
    officialReader?.close();
    cleanup();
  }
}
