import { readFileSync } from "node:fs";
import path from "node:path";

import { getDb } from "@/db/client";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import { MEAN_REVERSION_V0, type Bar, type Quote } from "@/lib/trader/intelligence/types";
import { buildM9DecisionTraceExport } from "@/lib/trader/research/m9-decision-trace-export";
import { createInMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import { computeReplayReproContentDigest } from "@/lib/trader/research/replay-repro-digest";
import { buildResearchValidationCycleIdPrefix } from "@/lib/trader/research/research-backtest-cycle-id";
import {
  runResearchValidationBacktest,
  type ResearchValidationBacktestArtifactSink,
} from "@/lib/trader/research/research-backtest-runner";
import {
  buildWp10DeterminismManifest,
  type Wp10DefaultReplayResult,
} from "@/lib/trader/research/wp10-determinism-evidence-harness";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION } from "@/lib/trader/research/strategy-candidate.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

export const WP10_USER_ID = "00000000-0000-4000-8000-0000000410u";
export const WP10_DATASET_ID = "dataset-htr-wp10";
export const WP10_RUN_ID = "run-htr-wp10";
export const WP10_STRATEGY_VERSION = "0.1.0";

export function loadWp10FixtureBars(): { bars: Bar[]; latestQuote: Quote } {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as { bars: Bar[]; latestQuote: Quote };
}

export type { Wp10DefaultReplayResult } from "@/lib/trader/research/wp10-determinism-evidence-harness";

export async function runWp10DefaultSessionReplay(
  generatedAt: string,
): Promise<Wp10DefaultReplayResult> {
  const session = await createInMemoryResearchBacktestSession();
  try {
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: WP10_USER_ID,
      email: "htr-wp10@waia.invalid",
      password: "password123",
      identityLabel: "HTR-WP10 Determinism",
    });
    const orgId = ensureUserCoreSeedSqlite(db, {
      userId: WP10_USER_ID,
      displayName: "HTR-WP10 Determinism",
    });
    await createSqliteRiskLimitsService(db).upsertLimitsForOrg(requireOrgContext(orgId), {
      ...DEFAULT_ORG_RISK_LIMITS,
    });

    const context = requireOrgContext(orgId);
    const costModel = createCostModelV1("10", "5");
    const { bars } = loadWp10FixtureBars();
    const artifactSink: ResearchValidationBacktestArtifactSink = {};

    const metrics = await runResearchValidationBacktest({
      context,
      bars,
      strategyId: MEAN_REVERSION_V0,
      strategyVersion: WP10_STRATEGY_VERSION,
      datasetId: WP10_DATASET_ID,
      runId: WP10_RUN_ID,
      split: "validation",
      costModel,
      deps: session.deps,
      orderRepository: session.orderRepository,
      accountKey: "htr-wp10",
      defaultQuantity: "0.01",
      cycleIdPrefix: buildResearchValidationCycleIdPrefix(WP10_RUN_ID),
      metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
      artifactSink,
      historicalExecutionProfile: session.historicalExecutionProfile,
    });

    const cycleResults = artifactSink.cycleResults ?? [];
    const decisionTrace = buildM9DecisionTraceExport({
      organizationId: orgId,
      strategyId: MEAN_REVERSION_V0,
      strategyVersion: WP10_STRATEGY_VERSION,
      cycleResults,
      generatedAt,
    });

    const reproDigest = computeReplayReproContentDigest({
      metrics,
      cycles: cycleResults.map((cycle) => ({
        evaluatedAt: cycle.evaluation.features.evaluatedAt,
        featureSetId: cycle.evaluation.features.featureSetId,
        signals: cycle.evaluation.signals.map((signal) => ({
          strategySignalId: signal.strategySignalId,
          strategyId: signal.strategyId,
          outcome: signal.outcome,
        })),
      })),
    });

    const orders = await session.orderRepository.listOrders(context);
    const orderIds: string[] = [];
    const fillIds: string[] = [];
    const fillExecutedAtIso: string[] = [];
    for (const order of orders) {
      orderIds.push(order.id);
      const fills = await session.orderRepository.listFills(context, order.id);
      for (const fill of fills) {
        fillIds.push(fill.id);
        fillExecutedAtIso.push(fill.executedAt.toISOString());
      }
    }
    orderIds.sort();
    fillIds.sort();
    fillExecutedAtIso.sort();

    const featureSetIds = cycleResults.map((cycle) => cycle.evaluation.features.featureSetId);
    const strategySignalIds = cycleResults.flatMap((cycle) =>
      cycle.evaluation.signals.map((signal) => signal.strategySignalId),
    );

    return {
      metrics,
      decisionTraceDigest: decisionTrace.contentDigest,
      reproDigest,
      cycleCount: cycleResults.length,
      closedTradeCount: "closedTrades" in metrics ? metrics.closedTrades : 0,
      orderIds,
      fillIds,
      fillExecutedAtIso,
      featureSetIds,
      strategySignalIds,
    };
  } finally {
    session.cleanup();
  }
}

export async function computeWp10DeterminismEvidence(
  generatedAt = "2026-01-01T00:00:00.000Z",
): Promise<{
  replay: Wp10DefaultReplayResult;
  manifest: ReturnType<typeof buildWp10DeterminismManifest>;
}> {
  const replay = await runWp10DefaultSessionReplay(generatedAt);
  return {
    replay,
    manifest: buildWp10DeterminismManifest(replay),
  };
}
