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
  createCostModelV1,
  type CostModelV1,
} from "@/lib/trader/execution/cost-model";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import { listMarketBarsPostgres } from "@/lib/trader/market-data/market-bars-repository-postgres";
import {
  insertResearchDatasetPostgres,
  type ResearchDatasetRecord,
} from "@/lib/trader/market-data/research-dataset-repository-postgres";
import {
  computeBarSetDigest,
  sealResearchDataset,
  splitBarsThreeWay,
} from "@/lib/trader/market-data/research-dataset";
import type { Bar, BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import { runBlindHoldoutValidation } from "@/lib/trader/research/blind-holdout-engine";
import { buildResearchEvidenceDocument } from "@/lib/trader/research/build-research-evidence-export";
import { ResearchOrchestratorError } from "@/lib/trader/research/errors";
import { recordResearchPipelineKnowledgePostgres } from "@/lib/trader/research/record-research-knowledge";
import { runResearchValidationBacktest } from "@/lib/trader/research/research-backtest-runner";
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
import { runWalkForwardValidation } from "@/lib/trader/research/walk-forward-engine";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

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
};

export type RunResearchPipelineResult = {
  dataset: ResearchDatasetRecord;
  backtestRunId: string;
  strategyCandidateId: string;
  blindValidationResultId: string;
  evidenceDocument: ResearchEvidenceDocument;
  knowledge: { marketEventId: string; knowledgeEdgeId: string };
};

function barsFromRecords(records: Awaited<ReturnType<typeof listMarketBarsPostgres>>): Bar[] {
  return records.map((record) => ({
    symbol: record.symbol,
    interval: record.interval,
    open: record.open,
    high: record.high,
    low: record.low,
    close: record.close,
    volume: record.volume,
    barOpenTime: record.barOpenTime,
    barCloseTime: record.barCloseTime,
  }));
}

async function resolveOrderRepository(
  factory: RunResearchPipelineInput["createOrderRepository"],
): Promise<OrderRepository> {
  return await factory();
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
    input.costModel ?? createCostModelV1(input.feesBps ?? "10", input.slippageBps ?? "5");
  const accountKey = input.accountKey ?? "research-default";
  const defaultQuantity = input.defaultQuantity ?? "0.01";
  const oosBarCount = input.oosBarCount ?? 2;
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

  const bars = barsFromRecords(barRecords);
  const splits = splitBarsThreeWay(bars);
  const sealed = sealResearchDataset(bars, splits);

  const dataset = await insertResearchDatasetPostgres(ex, input.context, {
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

  const backtestRunId = newId();
  await createBacktestRunPostgres(ex, input.context, {
    id: backtestRunId,
    datasetId: dataset.id,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    costModelVersion: costModel.version,
    split: "validation",
  });

  const validationRepo = await resolveOrderRepository(input.createOrderRepository);
  const validationMetrics = await runResearchValidationBacktest({
    context: input.context,
    bars: splits.validation,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    datasetId: dataset.id,
    runId: backtestRunId,
    split: "validation",
    costModel,
    deps: input.deps,
    orderRepository: validationRepo,
    accountKey,
    defaultQuantity,
    newId,
  });

  await insertBacktestResultPostgres(ex, input.context, {
    id: newId(),
    runId: backtestRunId,
    regimeLabel: "AGGREGATE",
    metrics: [
      {
        regimeLabel: "AGGREGATE",
        strategySignalId: input.strategyId,
        periodRealizedPnl: validationMetrics.periodRealizedPnl,
        periodTotalFees: validationMetrics.periodTotalFees,
        closedTradeCount: validationMetrics.tradeCount,
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
    requireMultiRegimeCoverage,
    runBacktest: async ({ bars, strategyId, strategyVersion }) => {
      const repo = await resolveOrderRepository(input.createOrderRepository);
      return runResearchValidationBacktest({
        context: input.context,
        bars,
        strategyId,
        strategyVersion,
        datasetId: dataset.id,
        runId: backtestRunId,
        split: "validation",
        costModel,
        deps: input.deps,
        orderRepository: repo,
        accountKey,
        defaultQuantity,
        newId,
      });
    },
    repository: {
      insertWalkForwardWindow: (context, row) => insertWalkForwardWindowPostgres(ex, context, row),
      updateStrategyCandidateStatus: (context, candidateId, status) =>
        updateStrategyCandidateStatusPostgres(ex, context, candidateId, status),
    },
    newId,
  });

  const blind = await runBlindHoldoutValidation({
    context: input.context,
    candidate: { ...candidate, status: "walk_forward_validated", blindUsed: false },
    datasetId: dataset.id,
    blindBars: splits.blind,
    expectedBlindDigest: dataset.blindDigest,
    requireMultiRegimeCoverage,
    runBacktest: async ({ bars, strategyId, strategyVersion }) => {
      const repo = await resolveOrderRepository(input.createOrderRepository);
      return runResearchValidationBacktest({
        context: input.context,
        bars,
        strategyId,
        strategyVersion,
        datasetId: dataset.id,
        runId: backtestRunId,
        split: "blind",
        costModel,
        deps: input.deps,
        orderRepository: repo,
        accountKey,
        defaultQuantity,
        newId,
      });
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

  const evidenceDocument = buildResearchEvidenceDocument({
    organizationId: input.context.organizationId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    datasetId: dataset.id,
    backtestRunId,
    strategyCandidateId: candidate.id,
    blindValidationResultId: blind.result.id,
    costModelVersion: costModel.version,
    walkForwardMetrics: walkForward.windows.map((window) => window.metrics),
    blindMetrics: blind.metrics,
  });

  await validateResearchEvidenceProvenancePostgres(ex, input.context, evidenceDocument);

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
  };
}

export { COST_MODEL_VERSION_V1 };
