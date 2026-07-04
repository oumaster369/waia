import { addDecimal } from "@/lib/trader/risk/numeric";
import type {
  ResearchRegimeMetricSliceV2,
  ResearchValidationMetrics,
  ResearchValidationMetricsV1,
  ResearchValidationMetricsV2,
} from "@/lib/trader/research/strategy-candidate.types";
import {
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1,
} from "@/lib/trader/research/strategy-candidate.types";

export function isResearchValidationMetricsV1(
  metrics: ResearchValidationMetrics,
): metrics is ResearchValidationMetricsV1 {
  return metrics.schemaVersion === RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1;
}

export function isResearchValidationMetricsV2(
  metrics: ResearchValidationMetrics,
): metrics is ResearchValidationMetricsV2 {
  return metrics.schemaVersion === RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION;
}

/** Legacy trade-count reader — v1 tradeCount or v2 closedTrades (real fills only). */
export function readLegacyTradeCount(metrics: ResearchValidationMetrics): number {
  return isResearchValidationMetricsV1(metrics) ? metrics.tradeCount : metrics.closedTrades;
}

/** Legacy period realized PnL reader — v1 periodRealizedPnl or v2 realizedPnl. */
export function readPeriodRealizedPnl(metrics: ResearchValidationMetrics): string {
  return isResearchValidationMetricsV1(metrics) ? metrics.periodRealizedPnl : metrics.realizedPnl;
}

export const RESEARCH_VALIDATION_METRIC_FIELDS = [
  "submittedOrders",
  "acceptedOrders",
  "filledOrders",
  "openPositions",
  "closedTrades",
  "markToCloseTrades",
  "rejectedSignals",
  "skippedSignals",
] as const;

export const RESEARCH_VALIDATION_PNL_FIELDS = [
  "realizedPnl",
  "markedPnl",
  "periodTotalFees",
] as const;

export type ResearchValidationMetricField = (typeof RESEARCH_VALIDATION_METRIC_FIELDS)[number];
export type ResearchValidationPnlField = (typeof RESEARCH_VALIDATION_PNL_FIELDS)[number];

export function createEmptyResearchRegimeMetricSlice(
  regimeLabel: string,
): ResearchRegimeMetricSliceV2 {
  return {
    regimeLabel,
    submittedOrders: 0,
    acceptedOrders: 0,
    filledOrders: 0,
    openPositions: 0,
    closedTrades: 0,
    markToCloseTrades: 0,
    realizedPnl: "0",
    markedPnl: "0",
    periodTotalFees: "0",
    rejectedSignals: 0,
    skippedSignals: 0,
  };
}

export function assertResearchValidationMetricsV2Coherence(
  metrics: ResearchValidationMetricsV2,
): void {
  for (const field of RESEARCH_VALIDATION_METRIC_FIELDS) {
    const aggregate = metrics[field];
    const sum = metrics.byRegime.reduce((total, slice) => total + slice[field], 0);
    if (sum !== aggregate) {
      throw new Error(
        `[research] metrics v2 aggregate ${field}=${aggregate} != sum(byRegime)=${sum}`,
      );
    }
  }

  for (const field of RESEARCH_VALIDATION_PNL_FIELDS) {
    const aggregate = metrics[field];
    const sum = metrics.byRegime.reduce((total, slice) => addDecimal(total, slice[field]), "0");
    if (sum !== aggregate) {
      throw new Error(
        `[research] metrics v2 aggregate ${field}=${aggregate} != sum(byRegime)=${sum}`,
      );
    }
  }
}

/** Explicit round-trip attribution for regime-coverage (M0 Phase 2; M0.5 may revise). */
export function countAttributedRoundTrips(
  slice: Pick<ResearchRegimeMetricSliceV2, "closedTrades" | "markToCloseTrades">,
): number {
  return slice.closedTrades + slice.markToCloseTrades;
}
