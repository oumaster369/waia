import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { runBacktest, type FhvCycleBoundarySnapshot } from "@/lib/trader/backtest/backtest-runner";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import { createEmptyHypothesisSessionState } from "@/lib/trader/intelligence/mi-core.types";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import { MEAN_REVERSION_V0, type Bar } from "@/lib/trader/intelligence/types";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import { createFhvCampaignIdentityContext } from "@/lib/trader/observability/fhv-campaign-identity";
import { createInMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import { createHtrInitialAccountRiskState } from "@/lib/trader/research/htr-initial-portfolio-contract";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { getDb } from "@/db/client";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000436";
const ORG_SLOT = 436;

function flatBars(count: number): Bar[] {
  const minimum = Math.max(count, 25);
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

async function seedContext() {
  const session = await createInMemoryResearchBacktestSession();
  const db = getDb();
  insertEmailPasswordUser(db, {
    id: USER_ID,
    email: "fhv-runtime-snapshot@waia.invalid",
    password: "password123",
    identityLabel: "FHV Runtime Snapshot",
  });
  const orgId = ensureUserCoreSeedSqlite(db, {
    userId: USER_ID,
    displayName: "FHV Runtime Snapshot",
  });
  return { session, context: requireOrgContext(orgId) };
}

describe("FHV runtime snapshot (Phase 3)", () => {
  let runRoot = "";

  afterEach(() => {
    if (runRoot) {
      rmSync(runRoot, { recursive: true, force: true });
      runRoot = "";
    }
  });

  it("FHV_HYPOTHESIS_STATE_CHECKPOINT_PASS: hypothesis session state round-trips on backtest result", async () => {
    const { session, context } = await seedContext();
    const bars = flatBars(5);
    const seed = createEmptyHypothesisSessionState();
    const result = await runBacktest({
      context,
      barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix: "fhv-hyp" }),
      deps: session.deps,
      orderRepository: session.orderRepository,
      accountKey: "fhv-hyp-account",
      defaultQuantity: "0.01",
      costModel: createCostModelV1("0", "0"),
      strategySignalIds: [MEAN_REVERSION_V0],
      strategyId: MEAN_REVERSION_V0,
      strategyVersion: "0.1.0",
      regimeLabel: "AGGREGATE",
      datasetId: "fhv-hyp-dataset",
      runId: "fhv-hyp-run",
      split: "validation",
      window: {
        start: new Date(bars[0]!.barOpenTime),
        end: new Date(bars.at(-1)!.barCloseTime),
      },
      accountState: createHtrInitialAccountRiskState(),
      exportedAt: new Date(bars.at(-1)!.barCloseTime),
      maxCycles: 3,
      hypothesisSessionState: seed,
      enableReplayFusedContext: false,
      historicalExecutionProfile: session.historicalExecutionProfile,
    });

    expect(result.hypothesisSessionState).toBeDefined();
    expect(result.hypothesisSessionState?.schemaVersion).toBe(seed.schemaVersion);
  });

  it("FHV_ORDER_RATE_SNAPSHOT_PASS: order rate store captures and restores snapshot", () => {
    const store = createInMemoryOrderRateStore();
    store.recordAndCount("BTC/USDT", 1_000, 60_000);
    store.recordAndCount("BTC/USDT", 2_000, 60_000);
    const snapshot = store.captureSnapshot();
    expect(snapshot.buckets["BTC/USDT"]).toHaveLength(2);

    store.clear();
    expect(store.recordAndCount("BTC/USDT", 3_000, 60_000)).toBe(1);
    store.restoreSnapshot(snapshot);
    expect(store.recordAndCount("BTC/USDT", 4_000, 60_000)).toBe(3);
  });

  it("FHV_ID_FRONTIER_CAPTURE_PASS: campaign identity frontier captures generator state", () => {
    const identity = createFhvCampaignIdentityContext({
      runId: "fhv-id-frontier-run",
      organizationId: "00000000-0000-4000-8000-0000000436",
    });
    const newId = identity.createNewIdFactory();
    const id1 = newId();
    const id2 = newId();
    const frontier = identity.captureFrontier(1);
    expect(frontier.newIdSeq).toBeGreaterThan(0);
    expect(id1).not.toBe(id2);
  });

  it("FHV_MOCK_EXCHANGE_CHECKPOINT_PASS: mock connector checkpoint round-trips", async () => {
    const connector = new MockExchangeConnector();
    await connector.validateCredentials({ apiKey: "k", apiSecret: "s" });
    const checkpoint = connector.captureCheckpointState();
    connector.restoreCheckpointState(checkpoint);
    expect(connector.captureCheckpointState()).toEqual(checkpoint);
  });

  it("FHV_CYCLE_BOUNDARY_SNAPSHOT_PASS: onCycleBoundary receives hypothesis and accounting fields", async () => {
    const { session, context } = await seedContext();
    const bars = flatBars(5);
    const snapshots: FhvCycleBoundarySnapshot[] = [];

    await runBacktest({
      context,
      barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix: "fhv-boundary" }),
      deps: session.deps,
      orderRepository: session.orderRepository,
      accountKey: "fhv-boundary-account",
      defaultQuantity: "0.01",
      costModel: createCostModelV1("0", "0"),
      strategySignalIds: [MEAN_REVERSION_V0],
      strategyId: MEAN_REVERSION_V0,
      strategyVersion: "0.1.0",
      regimeLabel: "AGGREGATE",
      datasetId: "fhv-boundary-dataset",
      runId: "fhv-boundary-run",
      split: "validation",
      window: {
        start: new Date(bars[0]!.barOpenTime),
        end: new Date(bars.at(-1)!.barCloseTime),
      },
      accountState: createHtrInitialAccountRiskState(),
      exportedAt: new Date(bars.at(-1)!.barCloseTime),
      maxCycles: 2,
      hypothesisSessionState: createEmptyHypothesisSessionState(),
      enableReplayFusedContext: false,
      historicalExecutionProfile: session.historicalExecutionProfile,
      onCycleBoundary: async (snapshot) => {
        snapshots.push(snapshot);
        return "continue" as const;
      },
    });

    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots[0]?.hypothesisSessionState).toBeDefined();
    expect(snapshots[0]?.cycleCount).toBeGreaterThan(0);
  });
});
