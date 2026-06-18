import { createHash } from "node:crypto";

import type { PaperClosedTrade } from "@/lib/trader/paper/paper-strategy-eval.types";
import type { PaperPnL, PaperPositionPnL } from "@/lib/trader/paper/paper-pnl.types";
import type {
  PaperPnLPeriodRollup,
  PaperPnLWindow,
} from "@/lib/trader/paper/paper-pnl-period.types";
import type { PaperStrategyEvaluation } from "@/lib/trader/paper/paper-strategy-eval.types";
import {
  PAPER_EVALUATION_EXPORT_SCHEMA_VERSION,
  type PaperEvaluationExportBundle,
  type PaperEvaluationExportDocument,
  type PaperEvaluationExportEvidenceBody,
  type SerializedPaperPnLWindow,
} from "@/lib/trader/paper/paper-evaluation-export.types";

export type SerializedPaperPositionPnL = {
  symbol: string;
  quantity: string;
  avgCost: string;
  costBasis: string;
  markPrice: string | null;
  marketValue: string | null;
  realizedPnl: string;
  unrealizedPnl: string | null;
  fees: string;
};

export type SerializedPaperPnL = {
  organizationId: string;
  executionMode: string;
  quoteCurrency: string;
  realizedPnl: string;
  unrealizedPnl: string | null;
  totalFees: string;
  totalPnl: string | null;
  positions: SerializedPaperPositionPnL[];
  feesByAsset: Record<string, string>;
  valuationGaps: string[];
  derivedAt: string;
};

export type SerializedPaperPnLPeriodRollup = {
  organizationId: string;
  executionMode: string;
  quoteCurrency: string;
  window: SerializedPaperPnLWindow;
  periodRealizedPnl: string;
  periodTotalFees: string;
  periodFeesByAsset: Record<string, string>;
  periodValuationGaps: string[];
  periodUnrealizedChange: string | null;
  periodTotalPnlChange: string | null;
  endSnapshot: SerializedPaperPnL;
  derivedAt: string;
};

export type SerializedPaperClosedTrade = {
  fillId: string;
  orderId: string;
  symbol: string;
  executedAt: string;
  quantity: string;
  price: string;
  tradePnl: string;
};

export type SerializedPaperStrategyEvaluation = {
  organizationId: string;
  executionMode: string;
  strategySignalId: string;
  quoteCurrency: string;
  window: SerializedPaperPnLWindow;
  periodRealizedPnl: string;
  periodTotalFees: string;
  periodFeesByAsset: Record<string, string>;
  periodValuationGaps: string[];
  periodUnrealizedChange: string | null;
  periodTotalPnlChange: string | null;
  endSnapshot: SerializedPaperPnL;
  closedTrades: SerializedPaperClosedTrade[];
  closedTradeCount: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  winRate: string | null;
  lossRate: string | null;
  averageWin: string | null;
  averageLoss: string | null;
  grossProfit: string;
  grossLoss: string;
  profitFactor: string | null;
  expectancy: string | null;
  maxRealizedDrawdown: string;
  recoveryFactor: string | null;
  derivedAt: string;
};

function serializeWindow(window: PaperPnLWindow): SerializedPaperPnLWindow {
  return {
    start: window.start.toISOString(),
    end: window.end.toISOString(),
  };
}

function sortPositions(positions: readonly PaperPositionPnL[]): SerializedPaperPositionPnL[] {
  return [...positions]
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .map((position) => ({
      symbol: position.symbol,
      quantity: position.quantity,
      avgCost: position.avgCost,
      costBasis: position.costBasis,
      markPrice: position.markPrice,
      marketValue: position.marketValue,
      realizedPnl: position.realizedPnl,
      unrealizedPnl: position.unrealizedPnl,
      fees: position.fees,
    }));
}

export function serializePaperPnL(pnl: PaperPnL): SerializedPaperPnL {
  return {
    organizationId: pnl.organizationId,
    executionMode: pnl.executionMode,
    quoteCurrency: pnl.quoteCurrency,
    realizedPnl: pnl.realizedPnl,
    unrealizedPnl: pnl.unrealizedPnl,
    totalFees: pnl.totalFees,
    totalPnl: pnl.totalPnl,
    positions: sortPositions(pnl.positions),
    feesByAsset: { ...pnl.feesByAsset },
    valuationGaps: [...pnl.valuationGaps].sort((a, b) => a.localeCompare(b)),
    derivedAt: pnl.derivedAt.toISOString(),
  };
}

export function serializePaperPnLPeriodRollup(
  rollup: PaperPnLPeriodRollup,
): SerializedPaperPnLPeriodRollup {
  return {
    organizationId: rollup.organizationId,
    executionMode: rollup.executionMode,
    quoteCurrency: rollup.quoteCurrency,
    window: serializeWindow(rollup.window),
    periodRealizedPnl: rollup.periodRealizedPnl,
    periodTotalFees: rollup.periodTotalFees,
    periodFeesByAsset: { ...rollup.periodFeesByAsset },
    periodValuationGaps: [...rollup.periodValuationGaps].sort((a, b) => a.localeCompare(b)),
    periodUnrealizedChange: rollup.periodUnrealizedChange,
    periodTotalPnlChange: rollup.periodTotalPnlChange,
    endSnapshot: serializePaperPnL(rollup.endSnapshot),
    derivedAt: rollup.derivedAt.toISOString(),
  };
}

function serializeClosedTrade(trade: PaperClosedTrade): SerializedPaperClosedTrade {
  return {
    fillId: trade.fillId,
    orderId: trade.orderId,
    symbol: trade.symbol,
    executedAt: trade.executedAt.toISOString(),
    quantity: trade.quantity,
    price: trade.price,
    tradePnl: trade.tradePnl,
  };
}

export function serializePaperStrategyEvaluation(
  evaluation: PaperStrategyEvaluation,
): SerializedPaperStrategyEvaluation {
  return {
    organizationId: evaluation.organizationId,
    executionMode: evaluation.executionMode,
    strategySignalId: evaluation.strategySignalId,
    quoteCurrency: evaluation.quoteCurrency,
    window: serializeWindow(evaluation.window),
    periodRealizedPnl: evaluation.periodRealizedPnl,
    periodTotalFees: evaluation.periodTotalFees,
    periodFeesByAsset: { ...evaluation.periodFeesByAsset },
    periodValuationGaps: [...evaluation.periodValuationGaps].sort((a, b) => a.localeCompare(b)),
    periodUnrealizedChange: evaluation.periodUnrealizedChange,
    periodTotalPnlChange: evaluation.periodTotalPnlChange,
    endSnapshot: serializePaperPnL(evaluation.endSnapshot),
    closedTrades: [...evaluation.closedTrades]
      .sort((a, b) => {
        const timeDelta = a.executedAt.getTime() - b.executedAt.getTime();
        if (timeDelta !== 0) {
          return timeDelta;
        }
        return a.fillId.localeCompare(b.fillId);
      })
      .map(serializeClosedTrade),
    closedTradeCount: evaluation.closedTradeCount,
    winCount: evaluation.winCount,
    lossCount: evaluation.lossCount,
    breakevenCount: evaluation.breakevenCount,
    winRate: evaluation.winRate,
    lossRate: evaluation.lossRate,
    averageWin: evaluation.averageWin,
    averageLoss: evaluation.averageLoss,
    grossProfit: evaluation.grossProfit,
    grossLoss: evaluation.grossLoss,
    profitFactor: evaluation.profitFactor,
    expectancy: evaluation.expectancy,
    maxRealizedDrawdown: evaluation.maxRealizedDrawdown,
    recoveryFactor: evaluation.recoveryFactor,
    derivedAt: evaluation.derivedAt.toISOString(),
  };
}

export function buildEvidenceBodyFromBundle(
  bundle: PaperEvaluationExportBundle,
): PaperEvaluationExportEvidenceBody {
  return {
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

export function canonicalizePaperEvaluationEvidenceBody(
  body: PaperEvaluationExportEvidenceBody,
): PaperEvaluationExportEvidenceBody {
  return sortKeysDeep(body) as PaperEvaluationExportEvidenceBody;
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

export function computePaperEvaluationExportDigest(
  body: PaperEvaluationExportEvidenceBody,
): string {
  const canonical = canonicalizePaperEvaluationEvidenceBody(body);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function toPaperEvaluationExportDocument(
  bundle: PaperEvaluationExportBundle,
): PaperEvaluationExportDocument {
  const evidenceBody = buildEvidenceBodyFromBundle(bundle);
  const contentDigest = computePaperEvaluationExportDigest(evidenceBody);

  return {
    schemaVersion: PAPER_EVALUATION_EXPORT_SCHEMA_VERSION,
    envelope: {
      organizationId: bundle.organizationId,
      executionMode: bundle.executionMode,
      window: serializeWindow(bundle.window),
      exportedAt: bundle.exportedAt.toISOString(),
      contentDigest,
    },
    evidenceBody: canonicalizePaperEvaluationEvidenceBody(evidenceBody),
  };
}
