import type { CostModelV1 } from "@/lib/trader/execution/cost-model";
import type { PaperBookExecutionMode } from "@/lib/trader/paper/paper-book.types";
import type { PaperPnLMarkPrices } from "@/lib/trader/paper/paper-pnl.types";
import type {
  PaperPnLPeriodRollup,
  PaperPnLWindow,
} from "@/lib/trader/paper/paper-pnl-period.types";
import type { PaperStrategyEvaluation } from "@/lib/trader/paper/paper-strategy-eval.types";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type {
  SerializedPaperClosedTrade,
  SerializedPaperPnL,
  SerializedPaperPnLPeriodRollup,
  SerializedPaperStrategyEvaluation,
} from "@/lib/trader/paper/serialize-paper-evaluation-export";

export type SerializedCostModelV1 = {
  version: string;
  feesBps: string;
  slippageBps: string;
};

export const BACKTEST_EVALUATION_EXPORT_SCHEMA_VERSION =
  "waia.trader.backtest-evaluation-export.v1" as const;

export type BacktestEvaluationExportSchemaVersion =
  typeof BACKTEST_EVALUATION_EXPORT_SCHEMA_VERSION;

export type BacktestEvaluationExportInput = {
  context: OrgContext;
  orderRepository: OrderRepository;
  window: PaperPnLWindow;
  strategySignalIds: string[];
  strategyId: string;
  strategyVersion: string;
  costModel: CostModelV1;
  regimeLabel: string;
  datasetId: string;
  runId: string;
  split: "train" | "validation" | "blind";
  cycleCount: number;
  executionMode?: PaperBookExecutionMode;
  markPrices?: PaperPnLMarkPrices;
  /** Caller-supplied audit timestamp; excluded from content digest. */
  exportedAt: Date;
};

export type BacktestEvaluationDataQuality = {
  reconciliationStatus: "clean";
  valuationGapCount: number;
  valuationGaps: string[];
  unrealizedAvailable: boolean;
  strategiesWithNoFills: string[];
};

export type BacktestEvaluationProvenance = {
  source: "backtest_run";
  runId: string;
  datasetId: string;
  split: "train" | "validation" | "blind";
  strategyId: string;
  strategyVersion: string;
  regimeLabel: string;
  costModelVersion: string;
  cycleCount: number;
  fillEventCount: number;
  filledOrderCount: number;
  strategySignalIds: string[];
  readModelSlices: [
    "paper-pnl.v1",
    "paper-pnl-period.v1",
    "paper-strategy-eval.v1",
    "backtest-cost-model.v1",
  ];
};

export type BacktestEvaluationExportBundle = {
  schemaVersion: BacktestEvaluationExportSchemaVersion;
  organizationId: string;
  executionMode: PaperBookExecutionMode;
  costModel: CostModelV1;
  window: PaperPnLWindow;
  strategyId: string;
  strategyVersion: string;
  regimeLabel: string;
  datasetId: string;
  runId: string;
  split: "train" | "validation" | "blind";
  cycleCount: number;
  orgPeriodRollup: PaperPnLPeriodRollup;
  strategyEvaluations: PaperStrategyEvaluation[];
  dataQuality: BacktestEvaluationDataQuality;
  provenance: BacktestEvaluationProvenance;
  exportedAt: Date;
};

export type SerializedPaperPnLWindow = {
  start: string;
  end: string;
};

export type BacktestEvaluationExportEvidenceBody = {
  costModel: SerializedCostModelV1;
  orgPeriodRollup: SerializedPaperPnLPeriodRollup;
  strategyEvaluations: SerializedPaperStrategyEvaluation[];
  dataQuality: BacktestEvaluationDataQuality;
  provenance: BacktestEvaluationProvenance;
};

export type BacktestEvaluationExportDocument = {
  schemaVersion: BacktestEvaluationExportSchemaVersion;
  envelope: {
    organizationId: string;
    executionMode: PaperBookExecutionMode;
    strategyId: string;
    strategyVersion: string;
    regimeLabel: string;
    datasetId: string;
    runId: string;
    split: "train" | "validation" | "blind";
    costModelVersion: string;
    window: SerializedPaperPnLWindow;
    exportedAt: string;
    contentDigest: string;
  };
  evidenceBody: BacktestEvaluationExportEvidenceBody;
};

export type BacktestEvaluationEvidenceSlot = {
  artifactSchemaVersion: BacktestEvaluationExportSchemaVersion;
  contentDigest: string;
  document: BacktestEvaluationExportDocument;
};

export type BacktestRegimeMetrics = {
  regimeLabel: string;
  strategySignalId: string;
  periodRealizedPnl: string;
  periodTotalFees: string;
  closedTradeCount: number;
  winRate: string | null;
  profitFactor: string | null;
  expectancy: string | null;
  maxRealizedDrawdown: string;
  recoveryFactor: string | null;
  evidenceContentDigest: string;
};

export type { SerializedPaperClosedTrade, SerializedPaperPnL };
