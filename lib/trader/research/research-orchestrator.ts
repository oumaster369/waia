import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  completeBacktestRunPostgres,
  createBacktestRunPostgres,
  insertBacktestResultPostgres,
} from "@/lib/trader/backtest/backtest-repository-postgres";
import {
  COST_MODEL_VERSION_V1,
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
  type CostModelV1,
} from "@/lib/trader/execution/cost-model";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import { listMarketBarsPostgres } from "@/lib/trader/market-data/market-bars-repository-postgres";
import type { ResearchDatasetRecord } from "@/lib/trader/market-data/research-dataset-repository-postgres";
import {
  computeBarSetDigest,
  sealResearchDataset,
  splitBarsThreeWay,
} from "@/lib/trader/market-data/research-dataset";
import { computeSidecarContentDigest } from "@/lib/trader/market-data/replay/sidecar-content-digest";
import type { Bar, BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";
import type { PaperCycleDeps, PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import type { PortfolioCycleContext } from "@/lib/trader/paper/paper-cycle.types";
import {
  assertM9BlindAuthorizationV2,
  M9_BLIND_AUTHORIZATION_SIDECAR_DIGEST_NONE,
} from "@/lib/trader/research/m9-operator-authorization";
import { barsFromMarketBarRecords } from "@/lib/trader/research/m9-dataset-seal-preview";
import { resolveM9ResearchDatasetPostgres } from "@/lib/trader/research/m9-dataset-preflight";
import { buildResearchGuardianContext } from "@/lib/trader/research/research-guardian-config";
import type { ResearchPipelineBacktestOptions } from "@/lib/trader/research/research-pipeline-config.types";
import type { StreamingEvidenceManifestRef } from "@/lib/trader/backtest/streaming-evidence";
import {
  compareReplayResumeIdentity,
  readReplayCheckpoint,
  type ReplayRunTerminalState,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { createStreamingEvidenceSink } from "@/lib/trader/backtest/streaming-evidence";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ResearchValidationBacktestArtifactSink } from "@/lib/trader/research/research-backtest-runner";
import {
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1,
  type ResearchValidationMetrics,
} from "@/lib/trader/research/strategy-candidate.types";
import {
  readLegacyTradeCount,
  readPeriodRealizedPnl,
} from "@/lib/trader/research/research-validation-metrics-taxonomy";
import { runBlindHoldoutValidation } from "@/lib/trader/research/blind-holdout-engine";
import { buildResearchEvidenceDocument } from "@/lib/trader/research/build-research-evidence-export";
import {
  MultiRegimeCoverageError,
  ResearchOrchestratorError,
  ResearchPipelineRegimeFailureError,
} from "@/lib/trader/research/errors";
import { recordResearchPipelineKnowledgePostgres } from "@/lib/trader/research/record-research-knowledge";
import { runIsolatedResearchBacktest } from "@/lib/trader/research/research-backtest-isolation";
import {
  buildResearchBlindCycleIdPrefix,
  buildResearchValidationCycleIdPrefix,
  buildResearchWalkForwardCycleIdPrefix,
} from "@/lib/trader/research/research-backtest-cycle-id";
import type { ResearchEvidenceDocument } from "@/lib/trader/research/research-evidence-export.types";
import {
  getBlindValidationResultForCandidatePostgres,
  insertBlindValidationResultPostgres,
  insertWalkForwardWindowPostgres,
  markStrategyCandidateBlindUsedPostgres,
  registerStrategyCandidatePostgres,
  updateStrategyCandidateStatusPostgres,
} from "@/lib/trader/research/strategy-candidate-repository-postgres";
import { validateResearchEvidenceProvenancePostgres } from "@/lib/trader/research/validate-research-evidence-provenance";
import { assertResearchPipelineRegimeCoverage } from "@/lib/trader/research/regime-coverage";
import { runWalkForwardValidation } from "@/lib/trader/research/walk-forward-engine";
import type { HistoricalExecutionProfileV1 } from "@/lib/trader/backtest/historical-execution-profile";
import type { HistoricalIntelligenceProfile } from "@/lib/trader/intelligence/historical-profile/historical-profile.types";
import type { IntelligenceCycleBundleRepository } from "@/lib/trader/intelligence/records/repository-adapters";
import type { ForecastDecisionBundleRepository } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-repository-adapters";
import type { CalibrationSink } from "@/lib/trader/intelligence/calibration/calibration.types";
import type { OutcomeResolutionSink } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import type { Wp21RuntimeDeps } from "@/lib/trader/intelligence/outcome-resolution/epistemic-closure-runtime";
import type { ConfidenceUpdateSink } from "@/lib/trader/knowledge/knowledge-confidence-update-repository-postgres";
import type { OutcomeResolutionReadPort } from "@/lib/trader/knowledge/mkb-read-model.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update" | "delete">;

export type RunResearchPipelineInput = {
  context: OrgContext;
  datasetName: string;
  symbol: InstrumentId;
  interval: BarInterval;
  strategyId: string;
  strategyVersion: string;
  paramsJson?: string;
  oosBarCount?: number;
  costModel?: CostModelV1;
  deps: PaperCycleDeps;
  /** Fresh repository per backtest window — prevents cross-window order contamination. */
  createOrderRepository: () => OrderRepository | Promise<OrderRepository>;
  accountKey?: string;
  defaultQuantity?: string;
  feesBps?: string;
  slippageBps?: string;
  newId?: () => string;
  requireMultiRegimeCoverage?: boolean;
  /** M9 v2 wiring — metrics schema, portfolio, guardian, blind authorization. */
  pipelineBacktest?: ResearchPipelineBacktestOptions;
  /** Optional filesystem checkpoint resume root (HTR-WP05). */
  replayResume?: {
    runRootDir: string;
    codeSha: string;
  };
  /** HTR-WP17: optional historical execution profile for HTR default research replay. */
  historicalExecutionProfile?: HistoricalExecutionProfileV1;
  /** HTR-WP21: opt-in historical intelligence profile for epistemic closure. */
  historicalProfile?: HistoricalIntelligenceProfile;
  /** HTR-WP13: intelligence records Postgres sink. */
  intelligenceRecordsSink?: IntelligenceCycleBundleRepository;
  /** HTR-WP14: forecast-decision Postgres sink. */
  forecastDecisionSink?: ForecastDecisionBundleRepository;
  /** HTR-WP21: outcome resolution sink. */
  outcomeResolutionSink?: OutcomeResolutionSink;
  /** HTR-WP21: calibration sink. */
  calibrationSink?: CalibrationSink;
  /** HTR-WP21: confidence update sink. */
  confidenceUpdateSink?: ConfidenceUpdateSink;
  /** HTR-WP21: bundled runtime deps. */
  wp21RuntimeDeps?: Wp21RuntimeDeps;
  /** HTR-WP21: MKB outcome read port. */
  outcomeResolutionReadPort?: OutcomeResolutionReadPort;
  /** HTR-WP21: Postgres executor for terminal MKB query. */
  wp21PostgresExecutor?: Pick<WaiaPostgresDb, "select" | "insert" | "execute">;
  /** HTR-WP21: provenance for epistemic records. */
  wp21Provenance?: { codeSha: string; datasetContentDigest: string };
};

export type RunResearchPipelineResult = {
  dataset: ResearchDatasetRecord;
  backtestRunId: string;
  strategyCandidateId: string;
  blindValidationResultId: string;
  evidenceDocument: ResearchEvidenceDocument;
  knowledge: { marketEventId: string; knowledgeEdgeId: string };
  walkForwardWindowCount: number;
  validationMetrics: ResearchValidationMetrics;
  blindMetrics: ResearchValidationMetrics;
  validationCycleResults?: readonly PaperCycleResult[];
  validationPortfolioContext?: PortfolioCycleContext;
  validationStreamingManifestRef?: StreamingEvidenceManifestRef;
  replayTerminalState?: ReplayRunTerminalState | null;
};

async function resolveOrderRepository(
  factory: RunResearchPipelineInput["createOrderRepository"],
): Promise<OrderRepository> {
  return await factory();
}

function buildIsolatedBacktestInput(
  input: RunResearchPipelineInput,
  params: {
    bars: readonly Bar[];
    datasetId: string;
    runId: string;
    split: "train" | "validation" | "blind";
    costModel: CostModelV1;
    orderRepository: OrderRepository;
    accountKey: string;
    defaultQuantity: string;
    newId: () => string;
    cycleIdPrefix: string;
    artifactSink?: ResearchValidationBacktestArtifactSink;
  },
) {
  const pipelineBacktest = input.pipelineBacktest;
  const metricsSchemaVersion =
    pipelineBacktest?.metricsSchemaVersion ?? RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1;

  return {
    context: input.context,
    bars: params.bars,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    datasetId: params.datasetId,
    runId: params.runId,
    split: params.split,
    costModel: params.costModel,
    deps: input.deps,
    orderRepository: params.orderRepository,
    accountKey: params.accountKey,
    defaultQuantity: params.defaultQuantity,
    newId: params.newId,
    cycleIdPrefix: params.cycleIdPrefix,
    metricsSchemaVersion,
    portfolioConfig: pipelineBacktest?.portfolioConfig,
    guardian: buildResearchGuardianContext(pipelineBacktest?.guardian),
    artifactSink: params.artifactSink,
    providerSidecar: pipelineBacktest?.providerSidecar,
    retentionMode: pipelineBacktest?.retentionMode,
    evidenceSink:
      pipelineBacktest?.evidenceSink ??
      (pipelineBacktest?.retentionMode === "STREAM_ONLY" && pipelineBacktest.evidenceRunDir
        ? createStreamingEvidenceSink({
            runDir: ensureEvidenceRunDir(pipelineBacktest.evidenceRunDir, params.runId),
            runId: params.runId,
            gitSha: pipelineBacktest.evidenceGitSha ?? null,
            environment: pipelineBacktest.evidenceEnvironment ?? "research-pipeline",
            dbConnectionMode: pipelineBacktest.evidenceDbConnectionMode ?? null,
          })
        : undefined),
    historicalExecutionProfile: input.historicalExecutionProfile,
    historicalProfile: input.historicalProfile,
    intelligenceRecordsSink: input.intelligenceRecordsSink,
    forecastDecisionSink: input.forecastDecisionSink,
    outcomeResolutionSink: input.outcomeResolutionSink,
    calibrationSink: input.calibrationSink,
    confidenceUpdateSink: input.confidenceUpdateSink,
    wp21RuntimeDeps: input.wp21RuntimeDeps,
    outcomeResolutionReadPort: input.outcomeResolutionReadPort,
    wp21PostgresExecutor: input.wp21PostgresExecutor,
    wp21Provenance: input.wp21Provenance,
  };
}

function ensureEvidenceRunDir(baseDir: string, runId: string): string {
  const runDir = join(baseDir, runId);
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

/**
 * Deterministic research pipeline orchestrator (RI-INTEGRATION-1).
 *
 * Stored bars → sealed dataset → backtest → walk-forward → blind → evidence → KB audit.
 */
export async function runResearchPipelinePostgres(
  ex: PgExecutor,
  input: RunResearchPipelineInput,
): Promise<RunResearchPipelineResult> {
  const newId = input.newId ?? crypto.randomUUID.bind(crypto);
  const costModel =
    input.costModel ?? costModelV1FromAuthority(createHtrHistoricalCostModelAuthorityV1());
  const accountKey = input.accountKey ?? "research-default";
  const defaultQuantity = input.defaultQuantity ?? "0.01";
  const oosBarCount = input.oosBarCount ?? 20;
  const requireMultiRegimeCoverage = input.requireMultiRegimeCoverage ?? true;

  const barRecords = await listMarketBarsPostgres(ex, input.context, {
    symbol: input.symbol,
    interval: input.interval,
  });

  if (barRecords.length < 60) {
    throw new ResearchOrchestratorError(
      "RESEARCH_PIPELINE_INSUFFICIENT_BARS",
      `need at least 60 stored bars (got ${barRecords.length})`,
    );
  }

  const bars = barsFromMarketBarRecords(barRecords);
  const splits = splitBarsThreeWay(bars);
  const sealed = sealResearchDataset(bars, splits);

  // 2. Content-bound operator blind authorization verification (DEE-398 / ADR-0022).
  // Runs immediately after sealing and before dataset persistence/backtest work: fails
  // closed on any mismatch between the operator-authorized scope and what was just sealed,
  // so no replay content can silently change after authorization and no compute is wasted
  // on an unauthorized run.
  const pipelineBacktest = input.pipelineBacktest;
  if (pipelineBacktest?.operatorBlindAuthorization) {
    const blindScope = pipelineBacktest.blindAuthorizationScope;
    if (!blindScope) {
      throw new ResearchOrchestratorError(
        "M9_BLIND_AUTHORIZATION_SCOPE_MISSING",
        "blind authorization scope must be provided with operator blind digest",
      );
    }
    assertM9BlindAuthorizationV2(pipelineBacktest.operatorBlindAuthorization, blindScope);

    if (blindScope.blindDigest !== sealed.blindDigest) {
      throw new ResearchOrchestratorError(
        "M9_BLIND_AUTHORIZATION_CONTENT_MISMATCH",
        `authorized blindDigest (${blindScope.blindDigest.slice(0, 12)}…) does not match the ` +
          `freshly sealed dataset blindDigest (${sealed.blindDigest.slice(0, 12)}…) — replay ` +
          "content changed after operator authorization",
      );
    }

    const runtimeSidecarDigest = pipelineBacktest.providerSidecar
      ? computeSidecarContentDigest(pipelineBacktest.providerSidecar)
      : M9_BLIND_AUTHORIZATION_SIDECAR_DIGEST_NONE;
    if (runtimeSidecarDigest !== blindScope.sidecarContentDigest) {
      throw new ResearchOrchestratorError(
        "M9_BLIND_AUTHORIZATION_CONTENT_MISMATCH",
        "authorized sidecarContentDigest does not match the runtime provider sidecar content " +
          "— replay content changed after operator authorization",
      );
    }
  } else if (pipelineBacktest?.blindAuthorizationScope) {
    throw new ResearchOrchestratorError(
      "M9_BLIND_AUTHORIZATION_REQUIRED",
      "operator blind authorization digest required before blind holdout stage",
    );
  }

  // 3. Dataset reuse/create — idempotent, content-addressed (DEE-398 / ADR-0022). Identical
  // repeat runs under the same (organizationId, datasetName) reuse the existing row; content
  // that diverges under the same name fails closed via M9DatasetContentConflictError.
  const { dataset } = await resolveM9ResearchDatasetPostgres(ex, input.context, {
    id: newId(),
    name: input.datasetName,
    symbol: input.symbol,
    interval: input.interval,
    sealed,
    metadata: {
      source: "trader_market_bars",
      barCount: bars.length,
      contentDigest: computeBarSetDigest(bars),
    },
    sealedAt: new Date(sealed.sealedAt),
  });

  const candidate = await registerStrategyCandidatePostgres(ex, input.context, {
    id: newId(),
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    paramsJson: input.paramsJson ?? "{}",
    status: "registered",
  });

  const backtestRunId = (() => {
    if (input.replayResume) {
      const checkpoint = readReplayCheckpoint(input.replayResume.runRootDir);
      if (!checkpoint) {
        throw new ResearchOrchestratorError(
          "REPLAY_CHECKPOINT_MISSING",
          "replay resume requested but checkpoint missing",
        );
      }
      compareReplayResumeIdentity(
        {
          backtestRunId: checkpoint.backtestRunId,
          datasetContentDigest: checkpoint.datasetContentDigest,
          codeSha: checkpoint.codeSha,
        },
        {
          backtestRunId: checkpoint.backtestRunId,
          datasetContentDigest: computeBarSetDigest(bars),
          codeSha: input.replayResume.codeSha,
        },
      );
      return checkpoint.backtestRunId;
    }
    return newId();
  })();
  await createBacktestRunPostgres(ex, input.context, {
    id: backtestRunId,
    datasetId: dataset.id,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    costModelVersion: costModel.version,
    split: "validation",
  });

  const validationRepo = await resolveOrderRepository(input.createOrderRepository);
  const validationArtifactSink = input.pipelineBacktest?.validationArtifactSink;
  const validationMetrics = await runIsolatedResearchBacktest(
    ex,
    buildIsolatedBacktestInput(input, {
      bars: splits.validation,
      datasetId: dataset.id,
      runId: backtestRunId,
      split: "validation",
      costModel,
      orderRepository: validationRepo,
      accountKey,
      defaultQuantity,
      newId,
      cycleIdPrefix: buildResearchValidationCycleIdPrefix(backtestRunId),
      artifactSink: validationArtifactSink,
    }),
  );

  await insertBacktestResultPostgres(ex, input.context, {
    id: newId(),
    runId: backtestRunId,
    regimeLabel: "AGGREGATE",
    metrics: [
      {
        regimeLabel: "AGGREGATE",
        strategySignalId: input.strategyId,
        periodRealizedPnl: readPeriodRealizedPnl(validationMetrics),
        periodTotalFees: validationMetrics.periodTotalFees,
        closedTradeCount: readLegacyTradeCount(validationMetrics),
        winRate: null,
        profitFactor: null,
        expectancy: null,
        maxRealizedDrawdown: "0",
        recoveryFactor: null,
        evidenceContentDigest: "",
      },
    ],
  });

  await completeBacktestRunPostgres(ex, input.context, {
    runId: backtestRunId,
    status: "completed",
    evidenceDigest: computeBarSetDigest(splits.validation),
  });

  await updateStrategyCandidateStatusPostgres(ex, input.context, candidate.id, "backtested");

  const walkForward = await runWalkForwardValidation({
    context: input.context,
    candidate: { ...candidate, status: "backtested" },
    trainBars: splits.train,
    validationBars: splits.validation,
    oosBarCount,
    runBacktest: async ({ bars, strategyId, strategyVersion, windowIndex }) => {
      const repo = await resolveOrderRepository(input.createOrderRepository);
      return runIsolatedResearchBacktest(
        ex,
        buildIsolatedBacktestInput(input, {
          bars,
          datasetId: dataset.id,
          runId: backtestRunId,
          split: "validation",
          costModel,
          orderRepository: repo,
          accountKey,
          defaultQuantity,
          newId,
          cycleIdPrefix: buildResearchWalkForwardCycleIdPrefix(backtestRunId, windowIndex),
        }),
      );
    },
    repository: {
      insertWalkForwardWindow: (context, row) => insertWalkForwardWindowPostgres(ex, context, row),
      updateStrategyCandidateStatus: (context, candidateId, status) =>
        updateStrategyCandidateStatusPostgres(ex, context, candidateId, status),
    },
    newId,
  });

  // Blind gate: single-use blind-holdout lockout (`markStrategyCandidateBlindUsedPostgres` /
  // `StrategyCandidateBlindLockoutError`), independent of and downstream from the
  // content-bound operator authorization verification already enforced in step 2 above.
  const blind = await runBlindHoldoutValidation({
    context: input.context,
    candidate: { ...candidate, status: "walk_forward_validated", blindUsed: false },
    datasetId: dataset.id,
    blindBars: splits.blind,
    expectedBlindDigest: dataset.blindDigest,
    runBacktest: async ({ bars, strategyId, strategyVersion }) => {
      const repo = await resolveOrderRepository(input.createOrderRepository);
      return runIsolatedResearchBacktest(
        ex,
        buildIsolatedBacktestInput(input, {
          bars,
          datasetId: dataset.id,
          runId: backtestRunId,
          split: "blind",
          costModel,
          orderRepository: repo,
          accountKey,
          defaultQuantity,
          newId,
          cycleIdPrefix: buildResearchBlindCycleIdPrefix(backtestRunId),
        }),
      );
    },
    repository: {
      getBlindValidationResultForCandidate: (context, candidateId) =>
        getBlindValidationResultForCandidatePostgres(ex, context, candidateId),
      insertBlindValidationResult: (context, row) =>
        insertBlindValidationResultPostgres(ex, context, row),
      markStrategyCandidateBlindUsed: (context, candidateId) =>
        markStrategyCandidateBlindUsedPostgres(ex, context, candidateId),
      updateStrategyCandidateStatus: (context, candidateId, status) =>
        updateStrategyCandidateStatusPostgres(ex, context, candidateId, status),
    },
    newId,
  });

  if (requireMultiRegimeCoverage) {
    const pipelineMetrics = [
      validationMetrics,
      ...walkForward.windows.map((window) => window.metrics),
      blind.metrics,
    ];
    try {
      assertResearchPipelineRegimeCoverage(pipelineMetrics);
    } catch (error) {
      if (error instanceof MultiRegimeCoverageError) {
        throw new ResearchPipelineRegimeFailureError(
          {
            organizationId: input.context.organizationId,
            strategyId: input.strategyId,
            strategyVersion: input.strategyVersion,
            candidateId: candidate.id,
            datasetId: dataset.id,
            backtestRunId,
            blindValidationResultId: blind.result.id,
            blindConsumed: true,
            walkForwardWindowCount: walkForward.windows.length,
            validationMetrics,
            walkForwardMetrics: walkForward.windows.map((window) => window.metrics),
            blindMetrics: blind.metrics,
          },
          error,
        );
      }
      throw error;
    }
  }

  const evidenceDocument = buildResearchEvidenceDocument({
    organizationId: input.context.organizationId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    datasetId: dataset.id,
    backtestRunId,
    strategyCandidateId: candidate.id,
    blindValidationResultId: blind.result.id,
    costModelVersion: costModel.version,
    validationMetrics,
    walkForwardMetrics: walkForward.windows.map((window) => window.metrics),
    blindMetrics: blind.metrics,
  });

  await validateResearchEvidenceProvenancePostgres(ex, input.context, evidenceDocument, {
    requireRegimeCoverage: requireMultiRegimeCoverage,
  });

  const knowledge = await recordResearchPipelineKnowledgePostgres(ex, input.context, {
    evidenceDocument,
    candidateId: candidate.id,
  });

  return {
    dataset,
    backtestRunId,
    strategyCandidateId: candidate.id,
    blindValidationResultId: blind.result.id,
    evidenceDocument,
    knowledge,
    walkForwardWindowCount: walkForward.windows.length,
    validationMetrics,
    blindMetrics: blind.metrics,
    validationCycleResults: validationArtifactSink?.cycleResults,
    validationPortfolioContext: validationArtifactSink?.portfolioContext,
    validationStreamingManifestRef: validationArtifactSink?.streamingManifestRef,
    // A full pipeline that reaches this return is completed; downstream finalization uses this to
    // block false success (a run that ended INFRA_DISCONNECT/SEALED_PARTIAL never reaches here).
    replayTerminalState: "REPLAY_RUN_OK",
  };
}

export { COST_MODEL_VERSION_V1 };
