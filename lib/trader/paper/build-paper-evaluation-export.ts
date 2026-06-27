import { loadPaperFillEvents, type PaperPnLFillEvent } from "@/lib/trader/paper/derive-paper-pnl";
import { derivePaperPnLPeriod } from "@/lib/trader/paper/derive-paper-pnl-period";
import { derivePaperStrategyEvaluations } from "@/lib/trader/paper/derive-paper-strategy-eval";
import { orderMatchesStrategyEvidenceScope } from "@/lib/trader/paper/strategy-evidence-scope";
import { PaperEvaluationExportError } from "@/lib/trader/paper/paper-evaluation-export.errors";
import {
  PAPER_EVALUATION_EXPORT_SCHEMA_VERSION,
  type PaperEvaluationExportBundle,
  type PaperEvaluationExportDocument,
  type PaperEvaluationExportInput,
} from "@/lib/trader/paper/paper-evaluation-export.types";
import type { PaperPnLWindow } from "@/lib/trader/paper/paper-pnl-period.types";
import { toPaperEvaluationExportDocument } from "@/lib/trader/paper/serialize-paper-evaluation-export";

function sortStrategySignalIds(strategySignalIds: readonly string[]): string[] {
  return [...strategySignalIds].sort((a, b) => a.localeCompare(b));
}

function assertNonEmptyStrategySignalIds(strategySignalIds: readonly string[]): void {
  if (strategySignalIds.length === 0) {
    throw new PaperEvaluationExportError("strategySignalIds must be non-empty");
  }
}

function strategyHasInWindowFills(
  fillEvents: readonly PaperPnLFillEvent[],
  strategySignalId: string,
  window: PaperPnLWindow,
): boolean {
  const startMs = window.start.getTime();
  const endMs = window.end.getTime();

  return fillEvents.some((event) => {
    if (!orderMatchesStrategyEvidenceScope(event.order, strategySignalId)) {
      return false;
    }
    const executedMs = event.fill.executedAt.getTime();
    return executedMs >= startMs && executedMs < endMs;
  });
}

function mergeValuationGaps(...gapLists: readonly string[][]): string[] {
  return [...new Set(gapLists.flat())].sort((a, b) => a.localeCompare(b));
}

/**
 * Compose S2 org period rollup + S3 strategy evaluations into an export bundle.
 *
 * Operational read model — not billing, HWM, promotion authorization, or persistence.
 */
export async function buildPaperEvaluationExport(
  input: PaperEvaluationExportInput,
): Promise<PaperEvaluationExportBundle> {
  assertNonEmptyStrategySignalIds(input.strategySignalIds);

  const executionMode = input.executionMode ?? "paper";
  const sortedStrategySignalIds = sortStrategySignalIds(input.strategySignalIds);
  const derivedAt = input.exportedAt;

  const { fillEvents, filledOrders } = await loadPaperFillEvents({
    context: input.context,
    orderRepository: input.orderRepository,
    executionMode,
  });

  const [orgPeriodRollup, strategyEvaluations] = await Promise.all([
    derivePaperPnLPeriod({
      context: input.context,
      orderRepository: input.orderRepository,
      executionMode,
      window: input.window,
      markPrices: input.markPrices,
      fillEvents,
      derivedAt,
    }),
    derivePaperStrategyEvaluations({
      context: input.context,
      orderRepository: input.orderRepository,
      strategySignalIds: sortedStrategySignalIds,
      window: input.window,
      executionMode,
      markPrices: input.markPrices,
      fillEvents,
      derivedAt,
    }),
  ]);

  const strategiesWithNoFills = sortedStrategySignalIds.filter(
    (strategySignalId) => !strategyHasInWindowFills(fillEvents, strategySignalId, input.window),
  );

  const valuationGaps = mergeValuationGaps(
    orgPeriodRollup.periodValuationGaps,
    ...strategyEvaluations.map((evaluation) => evaluation.periodValuationGaps),
  );

  return {
    schemaVersion: PAPER_EVALUATION_EXPORT_SCHEMA_VERSION,
    organizationId: input.context.organizationId,
    executionMode,
    window: input.window,
    orgPeriodRollup,
    strategyEvaluations,
    dataQuality: {
      reconciliationStatus: "clean",
      valuationGapCount: valuationGaps.length,
      valuationGaps,
      unrealizedAvailable: input.markPrices !== undefined,
      strategiesWithNoFills,
    },
    provenance: {
      source: "order_repository",
      fillEventCount: fillEvents.length,
      filledOrderCount: filledOrders.length,
      strategySignalIds: sortedStrategySignalIds,
      readModelSlices: ["paper-pnl.v1", "paper-pnl-period.v1", "paper-strategy-eval.v1"],
    },
    exportedAt: input.exportedAt,
  };
}

export async function buildPaperEvaluationExportDocument(
  input: PaperEvaluationExportInput,
): Promise<PaperEvaluationExportDocument> {
  const bundle = await buildPaperEvaluationExport(input);
  return toPaperEvaluationExportDocument(bundle);
}
