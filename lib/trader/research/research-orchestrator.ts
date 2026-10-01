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
import { createPostgresOrderExecutionServiceFromExecutor } from "@/lib/trader/execution/execution-service";
import { createPostgresReconciliationServiceFromExecutor } from "@/lib/trader/execution/reconciliation-service";
import { createPostgresOrderRepositoryFromExecutor } from "@/lib/trader/execution/repository-adapters";
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
import { assertDee540BlindTailAuthorized } from "@/lib/trader/research/dee-540-blind-tail-gate";
import {
  commitDee540BlindHoldout,
  type Dee540BlindTailExecutor,
} from "@/lib/trader/research/dee-540-blind-tail-commit";
import { M9_BLIND_AUTHORIZATION_SIDECAR_DIGEST_NONE } from "@/lib/trader/research/m9-operator-authorization";
import {
  buildResearchEvaluationPlan,
  type ResearchEvaluationPlanV1,
} from "@/lib/trader/research/research-train-parameter-fit";
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
import { buildResearchEvidenceDocument } from "@/lib/trader/research/build-research-evidence-export";
import { assertResearchRootPostgresDbV1 } from "@/lib/trader/research/research-root-postgres-db-v1";
import {
  MultiRegimeCoverageError,
  ResearchOrchestratorError,
  ResearchPipelineRegimeFailureError,
  StrategyCandidateNotFoundError,
} from "@/lib/trader/research/errors";
import { recordResearchPipelineKnowledgePostgres } from "@/lib/trader/research/record-research-knowledge";
import { runIsolatedResearchBacktest } from "@/lib/trader/research/research-backtest-isolation";
import {
  buildResearchBlindCycleIdPrefix,
  buildResearchValidationCycleIdPrefix,
} from "@/lib/trader/research/research-backtest-cycle-id";
import type { ResearchEvidenceDocument } from "@/lib/trader/research/research-evidence-export.types";
import {
  getBlindValidationResultForCandidatePostgres,
  getStrategyCandidateByIdPostgres,
  insertBlindValidationResultPostgres,
  insertWalkForwardWindowPostgres,
  markStrategyCandidateBlindUsedPostgres,
  registerStrategyCandidatePostgres,
  updateStrategyCandidateStatusPostgres,
} from "@/lib/trader/research/strategy-candidate-repository-postgres";
import { validateResearchEvidenceProvenancePostgres } from "@/lib/trader/research/validate-research-evidence-provenance";
import { assertResearchPipelineRegimeCoverage } from "@/lib/trader/research/regime-coverage";
import {
  accountWalkForwardFromFittedLookback,
  metricsFromFittedLookback,
} from "@/lib/trader/research/walk-forward-engine";
import type { HistoricalExecutionProfileV1 } from "@/lib/trader/backtest/historical-execution-profile";
import type { HistoricalIntelligenceProfile } from "@/lib/trader/intelligence/historical-profile/historical-profile.types";
import { createIntelligenceCycleBundleRepositoryPostgres } from "@/lib/trader/intelligence/records/atomic-cycle-bundle-repository-postgres";
import type { IntelligenceCycleBundleRepository } from "@/lib/trader/intelligence/records/repository-adapters";
import { createForecastDecisionBundleRepositoryPostgres } from "@/lib/trader/intelligence/forecast-decision/atomic-forecast-decision-bundle-repository-postgres";
import type { ForecastDecisionBundleRepository } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-repository-adapters";
import { createWp21RuntimeDepsPostgres } from "@/lib/trader/intelligence/outcome-resolution/epistemic-closure-runtime";
import type { CalibrationSink } from "@/lib/trader/intelligence/calibration/calibration.types";
import type { OutcomeResolutionSink } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import type { Wp21RuntimeDeps } from "@/lib/trader/intelligence/outcome-resolution/epistemic-closure-runtime";
import type { ConfidenceUpdateSink } from "@/lib/trader/knowledge/knowledge-confidence-update-repository-postgres";
import type { OutcomeResolutionReadPort } from "@/lib/trader/knowledge/mkb-read-model.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

/**
 * The blind tail was not executed. This is not a blind-validation result id
 * and must not be read as evidence that a holdout row exists.
 */
export const RESEARCH_PIPELINE_BLIND_TAIL_NOT_RUN = "not-produced" as const;

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update" | "delete" | "transaction">;

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
  /**
   * When set, research windows may submit mock orders. Production callers leave
   * this unset. This is not a holdout authority object.
   */
  submitResearchMockOrders?: boolean;
  /**
   * Runs inside the blind-window transaction after the strategy backtest
   * returns. A throw is a backtest failure: the consume and one terminal row
   * commit together. It does not clear the token.
   */
  afterBlindBacktest?: () => Promise<void>;
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
  parameterFit: ResearchEvaluationPlanV1;
  validationEvaluations: 1;
  validationCycleResults?: readonly PaperCycleResult[];
  validationPortfolioContext?: PortfolioCycleContext;
  validationStreamingManifestRef?: StreamingEvidenceManifestRef;
  replayTerminalState?: ReplayRunTerminalState | null;
};

function parseResearchParams(paramsJson: string | undefined): Record<string, unknown> {
  if (!paramsJson || paramsJson.trim() === "") {
    return {};
  }
  try {
    const parsed = JSON.parse(paramsJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

async function resolveOrderRepository(
  factory: RunResearchPipelineInput["createOrderRepository"],
): Promise<OrderRepository> {
  return await factory();
}

type BlindWindowBinding = {
  deps: PaperCycleDeps;
  intelligenceRecordsSink?: RunResearchPipelineInput["intelligenceRecordsSink"];
  forecastDecisionSink?: RunResearchPipelineInput["forecastDecisionSink"];
  outcomeResolutionSink?: RunResearchPipelineInput["outcomeResolutionSink"];
  calibrationSink?: RunResearchPipelineInput["calibrationSink"];
  confidenceUpdateSink?: RunResearchPipelineInput["confidenceUpdateSink"];
  wp21RuntimeDeps?: RunResearchPipelineInput["wp21RuntimeDeps"];
  outcomeResolutionReadPort?: RunResearchPipelineInput["outcomeResolutionReadPort"];
  wp21PostgresExecutor?: RunResearchPipelineInput["wp21PostgresExecutor"];
};

/**
 * Every Postgres dependency the blind window can touch, bound to the consume
 * transaction. Nested `transaction()` on that client is a savepoint. The
 * parent pool is guarded and must not be queried from here.
 */
function bindBlindWindowToExecutor(
  input: RunResearchPipelineInput,
  executor: Dee540BlindTailExecutor,
): BlindWindowBinding {
  const wp21 = input.wp21RuntimeDeps ? createWp21RuntimeDepsPostgres(executor) : undefined;
  return {
    deps: {
      ...input.deps,
      execution: createPostgresOrderExecutionServiceFromExecutor(executor),
      reconciliation: createPostgresReconciliationServiceFromExecutor(executor),
    },
    intelligenceRecordsSink: input.intelligenceRecordsSink
      ? createIntelligenceCycleBundleRepositoryPostgres(executor)
      : undefined,
    forecastDecisionSink: input.forecastDecisionSink
      ? createForecastDecisionBundleRepositoryPostgres(executor)
      : undefined,
    outcomeResolutionSink: wp21 ? wp21.outcomeResolutionSink : input.outcomeResolutionSink,
    calibrationSink: wp21 ? wp21.calibrationSink : input.calibrationSink,
    confidenceUpdateSink: wp21 ? wp21.confidenceUpdateSink : input.confidenceUpdateSink,
    wp21RuntimeDeps: wp21 ?? input.wp21RuntimeDeps,
    outcomeResolutionReadPort: wp21
      ? wp21.outcomeResolutionReadPort
      : input.outcomeResolutionReadPort,
    wp21PostgresExecutor: input.wp21PostgresExecutor ? executor : undefined,
  };
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
    wp21PostgresExecutor?: RunResearchPipelineInput["wp21PostgresExecutor"];
    bound?: BlindWindowBinding;
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
    deps: params.bound?.deps ?? input.deps,
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
    enableReplayFusedContext: pipelineBacktest?.enableReplayFusedContext,
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
    submitResearchMockOrders: input.submitResearchMockOrders,
    intelligenceRecordsSink: params.bound
      ? params.bound.intelligenceRecordsSink
      : input.intelligenceRecordsSink,
    forecastDecisionSink: params.bound
      ? params.bound.forecastDecisionSink
      : input.forecastDecisionSink,
    outcomeResolutionSink: params.bound
      ? params.bound.outcomeResolutionSink
      : input.outcomeResolutionSink,
    calibrationSink: params.bound ? params.bound.calibrationSink : input.calibrationSink,
    confidenceUpdateSink: params.bound
      ? params.bound.confidenceUpdateSink
      : input.confidenceUpdateSink,
    wp21RuntimeDeps: params.bound ? params.bound.wp21RuntimeDeps : input.wp21RuntimeDeps,
    outcomeResolutionReadPort: params.bound
      ? params.bound.outcomeResolutionReadPort
      : input.outcomeResolutionReadPort,
    wp21PostgresExecutor: params.bound
      ? params.bound.wp21PostgresExecutor
      : (params.wp21PostgresExecutor ?? input.wp21PostgresExecutor),
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
  assertResearchRootPostgresDbV1(ex);
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
  const parameterFit = buildResearchEvaluationPlan({
    trainBars: splits.train,
    validationBars: splits.validation,
  });

  // 2. DEE-540 verifies the grant before dataset persistence. Consumption is
  // one-shot and happens immediately before the blind backtest, after the
  // regime check, so a coverage failure cannot be used to retune on the tail.
  // skipBlindTail does not self-authorize and does not read the holdout.
  const pipelineBacktest = input.pipelineBacktest;
  const skipBlindTail = pipelineBacktest?.skipBlindTail === true;
  const blindGrant = skipBlindTail
    ? null
    : assertDee540BlindTailAuthorized({
        operatorBlindAuthorization: pipelineBacktest?.operatorBlindAuthorization,
        blindAuthorizationScope: pipelineBacktest?.blindAuthorizationScope,
        officialHoldoutAccessRequested: pipelineBacktest?.officialHoldoutAccessRequested,
      });
  if (blindGrant && blindGrant.blindAuthorizationScope.blindDigest !== sealed.blindDigest) {
    throw new ResearchOrchestratorError(
      "M9_BLIND_AUTHORIZATION_CONTENT_MISMATCH",
      `authorized blindDigest (${blindGrant.blindAuthorizationScope.blindDigest.slice(0, 12)}…) does not match the ` +
        `freshly sealed dataset blindDigest (${sealed.blindDigest.slice(0, 12)}…) — replay ` +
        "content changed after operator authorization",
    );
  }

  const runtimeSidecarDigest = pipelineBacktest?.providerSidecar
    ? computeSidecarContentDigest(pipelineBacktest.providerSidecar)
    : M9_BLIND_AUTHORIZATION_SIDECAR_DIGEST_NONE;
  if (
    blindGrant &&
    runtimeSidecarDigest !== blindGrant.blindAuthorizationScope.sidecarContentDigest
  ) {
    throw new ResearchOrchestratorError(
      "M9_BLIND_AUTHORIZATION_CONTENT_MISMATCH",
      "authorized sidecarContentDigest does not match the runtime provider sidecar content " +
        "— replay content changed after operator authorization",
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
    paramsJson: JSON.stringify({
      ...parseResearchParams(input.paramsJson),
      lookbackBars: String(parameterFit.fit.selectedLookback),
      researchParameterFit: "train_only",
      evidenceBacktestUsesTrainFit: false,
      trainFitAppliedTo: "walk_forward_window_slices",
      feeBps: parameterFit.fit.feeBps,
      slippageBps: parameterFit.fit.slippageBps,
    }),
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

  const walkForward = await accountWalkForwardFromFittedLookback({
    context: input.context,
    candidate: { ...candidate, status: "backtested" },
    trainBars: splits.train,
    validationBars: splits.validation,
    oosBarCount,
    lookback: parameterFit.fit.selectedLookback,
    repository: {
      insertWalkForwardWindow: (context, row) => insertWalkForwardWindowPostgres(ex, context, row),
      updateStrategyCandidateStatus: (context, candidateId, status) =>
        updateStrategyCandidateStatusPostgres(ex, context, candidateId, status),
    },
    newId,
  });

  const emptyBlindMetrics = metricsFromFittedLookback([], parameterFit.fit.selectedLookback);

  if (requireMultiRegimeCoverage) {
    const preBlindMetrics = [
      validationMetrics,
      ...walkForward.windows.map((window) => window.metrics),
    ];
    try {
      assertResearchPipelineRegimeCoverage(preBlindMetrics);
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
            blindValidationResultId: "",
            blindConsumed: false,
            walkForwardWindowCount: walkForward.windows.length,
            validationMetrics,
            walkForwardMetrics: walkForward.windows.map((window) => window.metrics),
            blindMetrics: emptyBlindMetrics,
          },
          error,
        );
      }
      throw error;
    }
  }

  const blind = await (async () => {
    if (skipBlindTail) {
      return {
        result: { id: RESEARCH_PIPELINE_BLIND_TAIL_NOT_RUN },
        metrics: emptyBlindMetrics,
      };
    }
    const persistedCandidate = await getStrategyCandidateByIdPostgres(
      ex,
      input.context,
      candidate.id,
    );
    if (!persistedCandidate) {
      throw new StrategyCandidateNotFoundError(candidate.id);
    }
    return commitDee540BlindHoldout(ex, {
      blindDigest: sealed.blindDigest,
      context: input.context,
      candidate: persistedCandidate,
      datasetId: dataset.id,
      blindBars: splits.blind,
      expectedBlindDigest: dataset.blindDigest,
      runBacktest: async ({ bars, executor }) => {
        const metrics = await runIsolatedResearchBacktest(
          executor,
          buildIsolatedBacktestInput(input, {
            bars,
            datasetId: dataset.id,
            runId: backtestRunId,
            split: "blind",
            costModel,
            orderRepository: createPostgresOrderRepositoryFromExecutor(executor),
            accountKey,
            defaultQuantity,
            newId,
            cycleIdPrefix: buildResearchBlindCycleIdPrefix(backtestRunId),
            artifactSink: input.pipelineBacktest?.blindArtifactSink,
            bound: bindBlindWindowToExecutor(input, executor),
          }),
        );
        if (input.afterBlindBacktest) await input.afterBlindBacktest();
        return metrics;
      },
      readRepository: {
        getBlindValidationResultForCandidate: (context, candidateId) =>
          getBlindValidationResultForCandidatePostgres(ex, context, candidateId),
      },
      bindRepository: (tx) => ({
        getBlindValidationResultForCandidate: (context, candidateId) =>
          getBlindValidationResultForCandidatePostgres(tx, context, candidateId),
        insertBlindValidationResult: (context, row) =>
          insertBlindValidationResultPostgres(tx, context, row),
        markStrategyCandidateBlindUsed: (context, candidateId) =>
          markStrategyCandidateBlindUsedPostgres(tx, context, candidateId),
        updateStrategyCandidateStatus: (context, candidateId, status) =>
          updateStrategyCandidateStatusPostgres(tx, context, candidateId, status),
      }),
      newId,
    });
  })();

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
    parameterFit,
    validationEvaluations: 1,
    validationCycleResults: validationArtifactSink?.cycleResults,
    validationPortfolioContext: validationArtifactSink?.portfolioContext,
    validationStreamingManifestRef: validationArtifactSink?.streamingManifestRef,
    // A full pipeline that reaches this return is completed; downstream finalization uses this to
    // block false success (a run that ended INFRA_DISCONNECT/SEALED_PARTIAL never reaches here).
    replayTerminalState: "REPLAY_RUN_OK",
  };
}

export { COST_MODEL_VERSION_V1 };
