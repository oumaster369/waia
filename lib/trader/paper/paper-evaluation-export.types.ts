import type { PaperBookExecutionMode } from "@/lib/trader/paper/paper-book.types";
import type { PaperPnLMarkPrices } from "@/lib/trader/paper/paper-pnl.types";
import type { PaperPnLWindow } from "@/lib/trader/paper/paper-pnl-period.types";
import type { PaperStrategyEvaluation } from "@/lib/trader/paper/paper-strategy-eval.types";
import type { PaperPnLPeriodRollup } from "@/lib/trader/paper/paper-pnl-period.types";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type {
  SerializedPaperClosedTrade,
  SerializedPaperPnL,
  SerializedPaperPnLPeriodRollup,
  SerializedPaperStrategyEvaluation,
} from "@/lib/trader/paper/serialize-paper-evaluation-export";

export const PAPER_EVALUATION_EXPORT_SCHEMA_VERSION =
  "waia.trader.paper-evaluation-export.v1" as const;

export type PaperEvaluationExportSchemaVersion = typeof PAPER_EVALUATION_EXPORT_SCHEMA_VERSION;

export type PaperEvaluationExportInput = {
  context: OrgContext;
  orderRepository: OrderRepository;
  window: PaperPnLWindow;
  strategySignalIds: string[];
  executionMode?: PaperBookExecutionMode;
  markPrices?: PaperPnLMarkPrices;
  /** Caller-supplied audit timestamp; excluded from content digest. */
  exportedAt: Date;
};

export type PaperEvaluationDataQuality = {
  reconciliationStatus: "clean";
  valuationGapCount: number;
  valuationGaps: string[];
  unrealizedAvailable: boolean;
  strategiesWithNoFills: string[];
};

export type PaperEvaluationProvenance = {
  source: "order_repository";
  fillEventCount: number;
  filledOrderCount: number;
  strategySignalIds: string[];
  readModelSlices: ["paper-pnl.v1", "paper-pnl-period.v1", "paper-strategy-eval.v1"];
};

export type PaperEvaluationExportBundle = {
  schemaVersion: PaperEvaluationExportSchemaVersion;
  organizationId: string;
  executionMode: PaperBookExecutionMode;
  window: PaperPnLWindow;
  orgPeriodRollup: PaperPnLPeriodRollup;
  strategyEvaluations: PaperStrategyEvaluation[];
  dataQuality: PaperEvaluationDataQuality;
  provenance: PaperEvaluationProvenance;
  exportedAt: Date;
};

export type SerializedPaperPnLWindow = {
  start: string;
  end: string;
};

export type PaperEvaluationExportEvidenceBody = {
  orgPeriodRollup: SerializedPaperPnLPeriodRollup;
  strategyEvaluations: SerializedPaperStrategyEvaluation[];
  dataQuality: PaperEvaluationDataQuality;
  provenance: PaperEvaluationProvenance;
};

export type PaperEvaluationExportDocument = {
  schemaVersion: PaperEvaluationExportSchemaVersion;
  envelope: {
    organizationId: string;
    executionMode: PaperBookExecutionMode;
    window: SerializedPaperPnLWindow;
    exportedAt: string;
    contentDigest: string;
  };
  evidenceBody: PaperEvaluationExportEvidenceBody;
};

export type PaperEvaluationEvidenceSlot = {
  artifactSchemaVersion: PaperEvaluationExportSchemaVersion;
  contentDigest: string;
  document: PaperEvaluationExportDocument;
};

export type { SerializedPaperClosedTrade, SerializedPaperPnL };
