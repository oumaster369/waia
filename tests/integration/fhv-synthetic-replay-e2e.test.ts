import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { runBacktest } from "@/lib/trader/backtest/backtest-runner";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import { MEAN_REVERSION_V0, type Bar } from "@/lib/trader/intelligence/types";
import {
  resolveFhvRunLogRoot,
  resolveFhvSemanticEventsPath,
} from "@/lib/trader/observability/fhv-run-log-layout";
import {
  createFhvObserverState,
  runFhvObserverTick,
} from "@/lib/trader/observability/fhv-observer-core";
import {
  readFhvOperatorStatusTolerant,
  resolveFhvOperatorStatusPath,
} from "@/lib/trader/observability/fhv-status-writer";
import { createInMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import { createHtrInitialAccountRiskState } from "@/lib/trader/research/htr-initial-portfolio-contract";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { getDb } from "@/db/client";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000416e2";
const STRATEGY_VERSION = "0.1.0";

function flatBars(count: number): Bar[] {
  const minimum = Math.max(count, 20);
  const bars: Bar[] = [];
  for (let index = 0; index < minimum; index += 1) {
    const openTime = new Date(
      Date.parse("2026-01-01T00:00:00.000Z") + index * 60_000,
    ).toISOString();
    const closeTime = new Date(Date.parse(openTime) + 60_000).toISOString();
    bars.push({
      symbol: "BTC/USDT",
      interval: "1m",
      barOpenTime: openTime,
      barCloseTime: closeTime,
      open: "65000.00",
      high: "65000.00",
      low: "65000.00",
      close: "65000.00",
      volume: "12.50",
    });
  }
  return bars;
}

async function seedSession() {
  const session = await createInMemoryResearchBacktestSession();
  const db = getDb();
  insertEmailPasswordUser(db, {
    id: USER_ID,
    email: "fhv-synthetic-replay-e2e@waia.invalid",
    password: "password123",
    identityLabel: "FHV Synthetic Replay E2E",
  });
  const orgId = ensureUserCoreSeedSqlite(db, {
    userId: USER_ID,
    displayName: "FHV Synthetic Replay E2E",
  });
  return { session, context: requireOrgContext(orgId) };
}

describe("DEE-416 FHV synthetic replay E2E", () => {
  it("runs short synthetic replay and writes observer status snapshot", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-synthetic-e2e-"));
    const { session, context } = await seedSession();
    const bars = flatBars(5);
    const window = {
      start: new Date(bars[0]!.barOpenTime),
      end: new Date(bars.at(-1)!.barCloseTime),
    };
    const runId = "fhv-synthetic-short-replay";
    const accountKey = "fhv-synthetic-account";

    try {
      const backtest = await runBacktest({
        context,
        barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix: "fhv-e2e" }),
        deps: session.deps,
        orderRepository: session.orderRepository,
        accountKey,
        defaultQuantity: "0.01",
        costModel: createCostModelV1("0", "0"),
        strategySignalIds: [MEAN_REVERSION_V0],
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: STRATEGY_VERSION,
        regimeLabel: "AGGREGATE",
        datasetId: "dataset-fhv-synthetic-e2e",
        runId,
        split: "validation",
        window,
        accountState: createHtrInitialAccountRiskState(),
        exportedAt: new Date(window.end),
        historicalExecutionProfile: session.historicalExecutionProfile,
        maxCycles: 3,
        enableReplayFusedContext: false,
        activeStrategyIds: ["__htr-blocked__"],
        fhvObservability: {
          runLogRoot: root,
        },
      });

      const runRoot = resolveFhvRunLogRoot({
        root,
        organizationId: context.organizationId,
        accountKey,
        runId,
      });
      expect(existsSync(resolveFhvSemanticEventsPath(runRoot))).toBe(true);

      const observerState = createFhvObserverState({
        runRoot,
        runId,
        organizationId: context.organizationId,
        commandSecret: "fhv-test-command-secret",
        observerTunnelSecret: "fhv-test-tunnel-secret",
      });
      const tick = await runFhvObserverTick(observerState, {
        nowMs: Date.parse("2026-07-21T06:00:00.000Z"),
        barsProcessed: backtest.cycleCount,
        barsTotal: backtest.cycleCount,
        phase: "validation",
        startedAt: window.start.toISOString(),
      });

      expect(tick.statusWritten).toBe(true);
      expect(existsSync(resolveFhvOperatorStatusPath(runRoot))).toBe(true);

      const status = readFhvOperatorStatusTolerant(runRoot);
      expect(status?.campaign.runId).toBe(runId);
      expect(status?.campaign.barsProcessed).toBe(backtest.cycleCount);
      expect(status?.schemaVersion).toBe("fhv-operator-status/v1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
