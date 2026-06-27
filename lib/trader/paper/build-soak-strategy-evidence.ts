import { buildPaperEvaluationExportDocument } from "@/lib/trader/paper/build-paper-evaluation-export";
import type { PaperBookExecutionMode } from "@/lib/trader/paper/paper-book.types";
import type { PaperEvaluationExportDocument } from "@/lib/trader/paper/paper-evaluation-export.types";
import type { PaperPnLWindow } from "@/lib/trader/paper/paper-pnl-period.types";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export const SOAK_STRATEGY_EVIDENCE_SCHEMA_VERSION =
  "waia.trader.paper-soak-strategy-evidence.v1" as const;

export const SOAK_STRATEGY_EVIDENCE_RUNBOOK =
  "docs/ops/DEE-337-P5-TWO-STRATEGY-AHR-RUNBOOK.md" as const;

export type SoakStrategyEvidenceInput = {
  context: OrgContext;
  orderRepository: OrderRepository;
  window: PaperPnLWindow;
  strategySignalIds: string[];
  executionMode?: PaperBookExecutionMode;
  accountKey?: string;
  exportedAt: Date;
};

export type SoakStrategyClosedTradeCount = {
  strategySignalId: string;
  closedTradeCount: number;
};

export type SoakStrategyEvidenceResult = {
  schemaVersion: typeof SOAK_STRATEGY_EVIDENCE_SCHEMA_VERSION;
  runbook: typeof SOAK_STRATEGY_EVIDENCE_RUNBOOK;
  organizationId: string;
  accountKey: string | null;
  window: { start: string; end: string };
  executionMode: PaperBookExecutionMode;
  strategyCounts: SoakStrategyClosedTradeCount[];
  /** True only when every required strategy has >= 1 closed trade in the window. */
  closedTradeEvidenceReady: boolean;
  strategiesWithZeroClosedTrades: string[];
  blockingReasons: string[];
  exportDocument: PaperEvaluationExportDocument;
  exportedAt: string;
};

function sortStrategySignalIds(strategySignalIds: readonly string[]): string[] {
  return [...strategySignalIds].sort((a, b) => a.localeCompare(b));
}

function assertNonEmptyStrategySignalIds(strategySignalIds: readonly string[]): void {
  if (strategySignalIds.length === 0) {
    throw new Error("strategySignalIds must be non-empty");
  }
}

/**
 * Build per-strategy closed-trade soak evidence from trader_orders/trader_fills.
 *
 * Operational read model for DEE-337 Phase 3 — evidence extraction only, not a soak substitute.
 */
export async function buildSoakStrategyEvidence(
  input: SoakStrategyEvidenceInput,
): Promise<SoakStrategyEvidenceResult> {
  assertNonEmptyStrategySignalIds(input.strategySignalIds);

  const executionMode = input.executionMode ?? "mock";
  const sortedStrategySignalIds = sortStrategySignalIds(input.strategySignalIds);

  const exportDocument = await buildPaperEvaluationExportDocument({
    context: input.context,
    orderRepository: input.orderRepository,
    window: input.window,
    strategySignalIds: sortedStrategySignalIds,
    executionMode,
    exportedAt: input.exportedAt,
  });

  const evaluationByStrategy = new Map(
    exportDocument.evidenceBody.strategyEvaluations.map((evaluation) => [
      evaluation.strategySignalId,
      evaluation.closedTradeCount,
    ]),
  );

  const strategyCounts: SoakStrategyClosedTradeCount[] = sortedStrategySignalIds.map(
    (strategySignalId) => ({
      strategySignalId,
      closedTradeCount: evaluationByStrategy.get(strategySignalId) ?? 0,
    }),
  );

  const strategiesWithZeroClosedTrades = strategyCounts
    .filter((entry) => entry.closedTradeCount === 0)
    .map((entry) => entry.strategySignalId);

  const blockingReasons =
    strategiesWithZeroClosedTrades.length === 0
      ? []
      : [
          `strategies with zero closed trades in window: ${strategiesWithZeroClosedTrades.join(", ")}`,
        ];

  return {
    schemaVersion: SOAK_STRATEGY_EVIDENCE_SCHEMA_VERSION,
    runbook: SOAK_STRATEGY_EVIDENCE_RUNBOOK,
    organizationId: input.context.organizationId,
    accountKey: input.accountKey ?? null,
    window: {
      start: input.window.start.toISOString(),
      end: input.window.end.toISOString(),
    },
    executionMode,
    strategyCounts,
    closedTradeEvidenceReady: strategiesWithZeroClosedTrades.length === 0,
    strategiesWithZeroClosedTrades,
    blockingReasons,
    exportDocument,
    exportedAt: input.exportedAt.toISOString(),
  };
}
