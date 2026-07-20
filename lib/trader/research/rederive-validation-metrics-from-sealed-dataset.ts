import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { Bar } from "@/lib/trader/intelligence/types";
import {
  COST_MODEL_VERSION_V1,
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
} from "@/lib/trader/execution/cost-model";
import { createInMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import { runResearchValidationBacktest } from "@/lib/trader/research/research-backtest-runner";
import { buildResearchValidationCycleIdPrefix } from "@/lib/trader/research/research-backtest-cycle-id";
import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type RederiveValidationMetricsInput = {
  context: OrgContext;
  validationBars: readonly Bar[];
  strategyId: string;
  strategyVersion: string;
  datasetId: string;
  backtestRunId: string;
  costModelVersion: string;
};

function resolveCostModel(costModelVersion: string) {
  if (costModelVersion !== COST_MODEL_VERSION_V1) {
    throw new Error(`[research] unsupported cost model version for re-derive: ${costModelVersion}`);
  }
  return costModelV1FromAuthority(createHtrHistoricalCostModelAuthorityV1());
}

/**
 * Replays validation-split backtest against sealed bars using in-memory SQLite orders.
 * Does not touch Postgres mock orders or rerun blind/walk-forward phases.
 */
export async function rederiveValidationMetricsFromSealedDataset(
  input: RederiveValidationMetricsInput,
): Promise<ResearchValidationMetrics> {
  const session = await createInMemoryResearchBacktestSession();
  try {
    const costModel = resolveCostModel(input.costModelVersion);
    return await runResearchValidationBacktest({
      context: input.context,
      bars: input.validationBars,
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
      datasetId: input.datasetId,
      runId: input.backtestRunId,
      split: "validation",
      costModel,
      deps: session.deps,
      orderRepository: session.orderRepository,
      accountKey: "see-a15-reconstruct",
      defaultQuantity: "0.01",
      cycleIdPrefix: `${buildResearchValidationCycleIdPrefix(input.backtestRunId)}-reconstruct`,
      historicalExecutionProfile: session.historicalExecutionProfile,
    });
  } finally {
    session.cleanup();
  }
}
