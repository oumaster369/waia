/**
 * DEE-397 / ADR-0021 — full-pipeline two-run reproducibility gate for the
 * deterministic M9 research replay substrate (PR1 / Task A).
 *
 * Runs the same fixture bars through the real research backtest path (real
 * risk engine, real mock-connector fills, real order repository — SQLite,
 * no Postgres required) twice, with fresh per-run deterministic clocks and
 * rate stores, separated by real wall-clock drift and different artifact
 * `generatedAt` values. Two runs over identical inputs must produce
 * byte-identical metrics, closed trades, and content digests.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import { MEAN_REVERSION_V0, type Bar, type Quote } from "@/lib/trader/intelligence/types";
import { buildM9DecisionTraceExport } from "@/lib/trader/research/m9-decision-trace-export";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import { createInMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import { buildResearchValidationCycleIdPrefix } from "@/lib/trader/research/research-backtest-cycle-id";
import {
  runResearchValidationBacktest,
  type ResearchValidationBacktestArtifactSink,
} from "@/lib/trader/research/research-backtest-runner";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION } from "@/lib/trader/research/strategy-candidate.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000397u";
const STRATEGY_VERSION = "0.1.0";

function loadFixtureBars(): { bars: Bar[]; latestQuote: Quote } {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as { bars: Bar[]; latestQuote: Quote };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ReplayRunResult = {
  metrics: unknown;
  decisionTraceDigest: string;
  cycleCount: number;
  closedTradeCount: number;
  /**
   * Fill `executedAt` timestamps recorded by the mock connector (DEE-397 / ADR-0021).
   * These come from the connector's injected clock, not the paper-cycle `nowMs`, so
   * without wiring the connector to the deterministic clock this would drift with
   * real wall-clock time between the two runs below.
   */
  fillExecutedAtIso: string[];
};

async function runFullReplay(generatedAt: string): Promise<ReplayRunResult> {
  const session = await createInMemoryResearchBacktestSession();
  try {
    // Session builder points the WaiaDb singleton at a fresh temp SQLite file; seed org + limits.
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "dee-397-repro@waia.invalid",
      password: "password123",
      identityLabel: "DEE-397 Deterministic Replay",
    });
    const orgId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "DEE-397 Deterministic Replay",
    });
    await createSqliteRiskLimitsService(db).upsertLimitsForOrg(requireOrgContext(orgId), {
      ...DEFAULT_ORG_RISK_LIMITS,
    });

    const context = requireOrgContext(orgId);
    const costModel = createCostModelV1("10", "5");
    const { bars } = loadFixtureBars();
    const artifactSink: ResearchValidationBacktestArtifactSink = {};

    const metrics = await runResearchValidationBacktest({
      context,
      bars,
      strategyId: MEAN_REVERSION_V0,
      strategyVersion: STRATEGY_VERSION,
      datasetId: "dataset-dee-397",
      runId: "run-dee-397",
      split: "validation",
      costModel,
      deps: session.deps,
      orderRepository: session.orderRepository,
      accountKey: "dee-397-repro",
      defaultQuantity: "0.01",
      newId: () => "00000000-0000-4000-8000-000000000397",
      cycleIdPrefix: buildResearchValidationCycleIdPrefix("run-dee-397"),
      metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
      artifactSink,
      historicalExecutionProfile: session.historicalExecutionProfile,
    });

    const cycleResults = artifactSink.cycleResults ?? [];
    const decisionTrace = buildM9DecisionTraceExport({
      organizationId: orgId,
      strategyId: MEAN_REVERSION_V0,
      strategyVersion: STRATEGY_VERSION,
      cycleResults,
      // Deliberately different per run — must not affect the content digest (ADR-0021).
      generatedAt,
    });

    const orders = await session.orderRepository.listOrders(context);
    const fillExecutedAtIso: string[] = [];
    for (const order of orders) {
      const fills = await session.orderRepository.listFills(context, order.id);
      for (const fill of fills) {
        fillExecutedAtIso.push(fill.executedAt.toISOString());
      }
    }
    fillExecutedAtIso.sort();

    return {
      metrics,
      decisionTraceDigest: decisionTrace.contentDigest,
      cycleCount: cycleResults.length,
      closedTradeCount: "closedTrades" in metrics ? metrics.closedTrades : 0,
      fillExecutedAtIso,
    };
  } finally {
    session.cleanup();
  }
}

describe("M9 deterministic replay substrate (DEE-397 / ADR-0021)", () => {
  it("produces byte-identical metrics, closed trades, and content digests across two replay runs separated by wall-clock drift", async () => {
    const first = await runFullReplay("2026-01-01T00:00:00.000Z");
    // Real wall-clock drift between runs — proves nowMs never leaks from Date.now().
    await delay(300);
    const second = await runFullReplay("2099-12-31T23:59:59.999Z");

    expect(first.cycleCount).toBeGreaterThan(0);
    expect(second.cycleCount).toBe(first.cycleCount);
    expect(second.closedTradeCount).toBe(first.closedTradeCount);
    expect(second.metrics).toEqual(first.metrics);
    expect(second.decisionTraceDigest).toBe(first.decisionTraceDigest);
    // Golden mean-reversion fixture may yield CDE NO_TRADE (canonical when understanding
    // is insufficient). Fill timestamp determinism is proven by HTR-WP10 order/lifecycle
    // suites with dedicated fill-producing fixtures; here we only require byte-identical
    // fill lists (including empty) across runs separated by wall-clock drift.
    expect(second.fillExecutedAtIso).toEqual(first.fillExecutedAtIso);
  });

  it("isolates the order-rate limiter per window so a saturated window cannot leak rejections into the next", () => {
    const rateStore = createInMemoryOrderRateStore();
    const windowMs = 3_600_000;
    const maxOrdersPerWindow = 3;
    const accountKey = "dee-397-isolation";

    // Window 1 (e.g. validation): saturate the bucket at bar-time cadence.
    const windowOneBaseMs = Date.parse("2026-01-01T00:00:00.000Z");
    for (let i = 0; i < maxOrdersPerWindow; i += 1) {
      rateStore.recordAndCount(accountKey, windowOneBaseMs + i * 60_000, windowMs);
    }

    // Without isolation, window 2 starting moments later would already be saturated.
    const windowTwoBaseMs = windowOneBaseMs + maxOrdersPerWindow * 60_000;
    const leakedCount = rateStore.recordAndCount(accountKey, windowTwoBaseMs, windowMs);
    expect(leakedCount).toBeGreaterThan(maxOrdersPerWindow);

    // The isolation hook (DEE-397 / ADR-0021) resets the store between windows.
    rateStore.clear();
    const isolatedCount = rateStore.recordAndCount(accountKey, windowTwoBaseMs, windowMs);
    expect(isolatedCount).toBe(1);
  });
});
