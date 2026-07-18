import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { runBacktest } from "@/lib/trader/backtest/backtest-runner";
import {
  assertProductionReplayEvidenceSinkConfigured,
  NOOP_REPLAY_EVIDENCE_SINK,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-sink";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import { MEAN_REVERSION_V0, type Bar } from "@/lib/trader/intelligence/types";
import {
  FHV_REPORT_FILE_NAMES,
  resolveFhvReportsDir,
  resolveFhvRunLogRoot,
  resolveFhvSemanticEventsPath,
} from "@/lib/trader/observability/fhv-run-log-layout";
import { createInMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import { createHtrInitialAccountRiskState } from "@/lib/trader/research/htr-initial-portfolio-contract";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { getDb } from "@/db/client";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000415a4";
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
    email: "corrective-a4-fhv@waia.invalid",
    password: "password123",
    identityLabel: "Corrective A4 FHV",
  });
  const orgId = ensureUserCoreSeedSqlite(db, {
    userId: USER_ID,
    displayName: "Corrective A4 FHV",
  });
  return { session, context: requireOrgContext(orgId) };
}

describe("DEE-415 C-A4 FHV report emission integration (G4)", () => {
  it("short replay emits operator, six FHV reports, and JSONL semantic events", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-a4-integration-"));
    const { session, context } = await seedSession();
    const bars = flatBars(5);
    const window = {
      start: new Date(bars[0]!.barOpenTime),
      end: new Date(bars.at(-1)!.barCloseTime),
    };
    const runId = "corrective-a4-short-replay";
    const accountKey = "corrective-a4-account";

    try {
      await runBacktest({
        context,
        barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix: "a4-fhv" }),
        deps: session.deps,
        orderRepository: session.orderRepository,
        accountKey,
        defaultQuantity: "0.01",
        costModel: createCostModelV1("0", "0"),
        strategySignalIds: [MEAN_REVERSION_V0],
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: STRATEGY_VERSION,
        regimeLabel: "AGGREGATE",
        datasetId: "dataset-corrective-a4",
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
      const eventsPath = resolveFhvSemanticEventsPath(runRoot);
      const reportsDir = resolveFhvReportsDir(runRoot);

      expect(existsSync(eventsPath)).toBe(true);
      expect(readFileSync(eventsPath, "utf8").split("\n").filter(Boolean).length).toBeGreaterThan(
        0,
      );
      for (const fileName of Object.values(FHV_REPORT_FILE_NAMES)) {
        expect(existsSync(join(reportsDir, fileName))).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("forbids production NOOP evidence sink in FHV mode", () => {
    expect(() => assertProductionReplayEvidenceSinkConfigured(undefined, true)).toThrow(
      "NOOP_PRODUCTION_PATH_FORBIDDEN",
    );
    expect(() =>
      assertProductionReplayEvidenceSinkConfigured(NOOP_REPLAY_EVIDENCE_SINK, true),
    ).toThrow("NOOP_PRODUCTION_PATH_FORBIDDEN");
    expect(() =>
      assertProductionReplayEvidenceSinkConfigured(NOOP_REPLAY_EVIDENCE_SINK, false),
    ).not.toThrow();
  });

  it("scopes run artifacts under org/account/run directories", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-a4-scope-"));
    const { session, context } = await seedSession();
    const bars = flatBars(3);
    const window = {
      start: new Date(bars[0]!.barOpenTime),
      end: new Date(bars.at(-1)!.barCloseTime),
    };
    const runId = "corrective-a4-scoped-run";
    const accountKey = "scoped-account";

    try {
      await runBacktest({
        context,
        barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix: "a4-scope" }),
        deps: session.deps,
        orderRepository: session.orderRepository,
        accountKey,
        defaultQuantity: "0.01",
        costModel: createCostModelV1("0", "0"),
        strategySignalIds: [MEAN_REVERSION_V0],
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: STRATEGY_VERSION,
        regimeLabel: "AGGREGATE",
        datasetId: "dataset-corrective-a4-scope",
        runId,
        split: "validation",
        window,
        accountState: createHtrInitialAccountRiskState(),
        exportedAt: new Date(window.end),
        historicalExecutionProfile: session.historicalExecutionProfile,
        maxCycles: 1,
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
      expect(runRoot.endsWith(join(accountKey, runId))).toBe(true);
      expect(existsSync(resolveFhvSemanticEventsPath(runRoot))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
