import { createHash } from "node:crypto";

import type { CostModelV1 } from "@/lib/trader/execution/cost-model";
import type { PaperPnLWindow } from "@/lib/trader/paper/paper-pnl-period.types";
import {
  serializePaperPnLPeriodRollup,
  serializePaperStrategyEvaluation,
} from "@/lib/trader/paper/serialize-paper-evaluation-export";
import {
  BACKTEST_EVALUATION_EXPORT_SCHEMA_VERSION,
  type BacktestEvaluationExportBundle,
  type BacktestEvaluationExportDocument,
  type BacktestEvaluationExportEvidenceBody,
  type SerializedCostModelV1,
  type SerializedPaperPnLWindow,
} from "@/lib/trader/backtest/backtest-evaluation-export.types";

function serializeWindow(window: PaperPnLWindow): SerializedPaperPnLWindow {
  return {
    start: window.start.toISOString(),
    end: window.end.toISOString(),
  };
}

export function serializeCostModelV1(costModel: CostModelV1): SerializedCostModelV1 {
  return {
    version: costModel.version,
    feesBps: costModel.feesBps,
    slippageBps: costModel.slippageBps,
  };
}

export function buildEvidenceBodyFromBacktestBundle(
  bundle: BacktestEvaluationExportBundle,
): BacktestEvaluationExportEvidenceBody {
  return {
    costModel: serializeCostModelV1(bundle.costModel),
    orgPeriodRollup: serializePaperPnLPeriodRollup(bundle.orgPeriodRollup),
    strategyEvaluations: [...bundle.strategyEvaluations]
      .sort((a, b) => a.strategySignalId.localeCompare(b.strategySignalId))
      .map(serializePaperStrategyEvaluation),
    dataQuality: {
      ...bundle.dataQuality,
      valuationGaps: [...bundle.dataQuality.valuationGaps].sort((a, b) => a.localeCompare(b)),
      strategiesWithNoFills: [...bundle.dataQuality.strategiesWithNoFills].sort((a, b) =>
        a.localeCompare(b),
      ),
    },
    provenance: {
      ...bundle.provenance,
      strategySignalIds: [...bundle.provenance.strategySignalIds].sort((a, b) =>
        a.localeCompare(b),
      ),
    },
  };
}

export function canonicalizeBacktestEvaluationEvidenceBody(
  body: BacktestEvaluationExportEvidenceBody,
): BacktestEvaluationExportEvidenceBody {
  return sortKeysDeep(body) as BacktestEvaluationExportEvidenceBody;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeysDeep(entry));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort((a, b) => a.localeCompare(b))
        .map((key) => [key, sortKeysDeep(record[key])]),
    );
  }
  return value;
}

export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

export function computeBacktestEvaluationExportDigest(
  body: BacktestEvaluationExportEvidenceBody,
): string {
  const canonical = canonicalizeBacktestEvaluationEvidenceBody(body);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function toBacktestEvaluationExportDocument(
  bundle: BacktestEvaluationExportBundle,
): BacktestEvaluationExportDocument {
  const evidenceBody = buildEvidenceBodyFromBacktestBundle(bundle);
  const contentDigest = computeBacktestEvaluationExportDigest(evidenceBody);

  return {
    schemaVersion: BACKTEST_EVALUATION_EXPORT_SCHEMA_VERSION,
    envelope: {
      organizationId: bundle.organizationId,
      executionMode: bundle.executionMode,
      strategyId: bundle.strategyId,
      strategyVersion: bundle.strategyVersion,
      regimeLabel: bundle.regimeLabel,
      datasetId: bundle.datasetId,
      runId: bundle.runId,
      split: bundle.split,
      costModelVersion: bundle.costModel.version,
      window: serializeWindow(bundle.window),
      exportedAt: bundle.exportedAt.toISOString(),
      contentDigest,
    },
    evidenceBody: canonicalizeBacktestEvaluationEvidenceBody(evidenceBody),
  };
}
