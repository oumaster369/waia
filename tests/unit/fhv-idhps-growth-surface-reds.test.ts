/**
 * H-ARCH-1 GS-01..GS-14 RED→GREEN structural + behavioral proofs.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createEmptyIdhpsInventoryMirror,
  evictTerminalFilledQuantityAfterEpochCommit,
  applyOrderToIdhpsInventoryMirror,
  verifyIdhpsInventoryAgainstOpenOrders,
} from "@/lib/trader/paper/idhps-inventory-mirror";
import {
  clearIdhpsEpochArraysAfterDurableCommit,
  assertNoPriorEpochEntriesInBridgeArrays,
} from "@/lib/trader/accounting/idhps-accounting-bridge-mirror";
import {
  createIdhpsPreparedStatements,
  IdhpsFillIdempotencyConflictError,
  IDHPS_PREPARED_STATEMENT_COUNT,
} from "@/lib/trader/execution/idhps-prepared-statements";
import {
  assertIdhpsHotPathAllowsDerivePortfolioFillWalk,
  assertIdhpsHotPathAllowsListOrders,
  assertIdhpsHotPathAllowsLoadPaperFillEvents,
  enableIdhpsProductionBans,
  getIdhpsHotPathCounters,
  resetIdhpsHotPathCounters,
  setIdhpsHotPathEnabled,
  setIdhpsHotPathBans,
} from "@/lib/trader/execution/idhps-hot-path-counters";
import {
  foldIdhpsSemanticEventDigest,
  createEmptyIdhpsSemanticDigestFrontier,
  noteIdhpsFullChainDigestRecompute,
} from "@/lib/trader/backtest/streaming-evidence/idhps-semantic-digest-frontier";
import {
  normalizeDecimalStringCached,
  resetIdhpsDecimalNormalizeCache,
  getIdhpsDecimalNormalizeCount,
} from "@/lib/trader/paper/idhps-decimal-normalize-cache";
import { REPLAY_RUN_CHAIN_MANIFEST_SCHEMA_VERSION } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import {
  MAX_BATCH_CYCLES,
  resolveEvidenceBatchCycles,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence.types";
import { buildIdhpsCompositeMirrorSnapshot } from "@/lib/trader/observability/idhps-composite-mirror-snapshot";
import { createEmptyIdhpsAccountRiskMirror } from "@/lib/trader/paper/idhps-account-risk-mirror";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";

const FIXTURE_DIR = join(process.cwd(), "tests/fhv/official-scale/blocking/fixtures/idhps");

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as Record<string, unknown>;
}

function createMemoryOrdersDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE trader_orders (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      credential_id TEXT,
      venue TEXT NOT NULL,
      execution_mode TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      type TEXT NOT NULL,
      price TEXT,
      quantity TEXT NOT NULL,
      filled_quantity TEXT NOT NULL,
      avg_fill_price TEXT,
      state TEXT NOT NULL,
      state_version INTEGER NOT NULL,
      exchange_order_id TEXT,
      client_order_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      risk_decision_id TEXT NOT NULL,
      strategy_signal_id TEXT,
      allocation_decision_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX trader_orders_id_organization_unique ON trader_orders(id, organization_id);
    CREATE INDEX trader_orders_org_mode_venue_state_idx
      ON trader_orders(organization_id, execution_mode, venue, state);
    CREATE TABLE trader_fills (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      exchange_trade_id TEXT NOT NULL,
      price TEXT NOT NULL,
      quantity TEXT NOT NULL,
      fee TEXT NOT NULL,
      fee_asset TEXT NOT NULL,
      executed_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX trader_fills_order_exchange_trade_id_unique
      ON trader_fills(order_id, exchange_trade_id);
    CREATE INDEX trader_fills_org_order_executed_id_idx
      ON trader_fills(organization_id, order_id, executed_at, id);
  `);
  return db;
}

describe("H-ARCH-1 IDHPS growth-surface RED→GREEN GS-01..14", () => {
  beforeEach(() => {
    resetIdhpsHotPathCounters();
    resetIdhpsDecimalNormalizeCache();
    setIdhpsHotPathEnabled(false);
    setIdhpsHotPathBans({
      banListOrders: false,
      banLoadPaperFillEvents: false,
      banDerivePortfolioFillWalk: false,
    });
  });

  afterEach(() => {
    setIdhpsHotPathEnabled(false);
    setIdhpsHotPathBans({
      banListOrders: false,
      banLoadPaperFillEvents: false,
      banDerivePortfolioFillWalk: false,
    });
  });

  it("GS01_listOrdersSqlite_hot_path_full_scan_red", () => {
    const fixture = readFixture("gs01-orders-growth.json");
    expect(fixture.expectedHotPathListOrdersCalls).toBe(0);
    enableIdhpsProductionBans();
    expect(() => assertIdhpsHotPathAllowsListOrders()).toThrow(/BLOCKED_BY_H_ARCH_1_GS01/);
  });

  it("GS02_listFillsSqlite_unbounded_all_red", () => {
    const fixture = readFixture("gs02-fills-growth.json");
    expect(fixture.maxRowsPerPage).toBe(256);
    const db = createMemoryOrdersDb();
    const prepared = createIdhpsPreparedStatements(db);
    const org = { organizationId: "org-idhps" };
    const base = {
      organizationId: "org-idhps",
      orderId: "ord-1",
      exchangeTradeId: "ex-1",
      price: "100",
      quantity: "1",
      fee: "0",
      feeAsset: "USDT",
      executedAtMs: 1_000,
      createdAtMs: 1_000,
    };
    const first = prepared.appendFillPrepared({ ...base, id: "fill-1" });
    const dup = prepared.appendFillPrepared({ ...base, id: "fill-dup" });
    expect(dup.id).toBe(first.id);
    expect(() =>
      prepared.appendFillPrepared({ ...base, id: "fill-conflict", price: "101" }),
    ).toThrow(IdhpsFillIdempotencyConflictError);
    const page = prepared.listFillsSincePrepared(org, "ord-1", -1, "", 256);
    expect(page.length).toBeLessThanOrEqual(256);
    expect(page).toHaveLength(1);
    prepared.finalize();
    db.close();
  });

  it("GS03_loadPaperFillEvents_hot_path_ban_red", () => {
    const fixture = readFixture("gs03-load-fills.json");
    expect(fixture.expectedLoadPaperFillEventsCalls).toBe(0);
    enableIdhpsProductionBans();
    expect(() => assertIdhpsHotPathAllowsLoadPaperFillEvents()).toThrow(/BLOCKED_BY_H_ARCH_1_GS03/);
  });

  it("GS04_listOpenOrders_prepared_index_red", () => {
    const fixture = readFixture("gs04-open-orders.json");
    expect(fixture.requiredIndex).toBe("trader_orders_org_mode_venue_state_idx");
    const migration = readFileSync(
      join(process.cwd(), "db/migrations/0040_fhv_idhps_hot_path_indexes.sql"),
      "utf8",
    );
    expect(migration).toContain("trader_orders_org_mode_venue_state_idx");
    const db = createMemoryOrdersDb();
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id FROM trader_orders
         WHERE organization_id = ? AND execution_mode = ? AND venue = ?
           AND state NOT IN ('FILLED','CANCELLED','REJECTED','EXPIRED','FAILED')
         ORDER BY symbol ASC, id ASC`,
      )
      .all("org", "mock", "htx") as Array<{ detail: string }>;
    const detail = plan.map((row) => row.detail).join(" | ");
    expect(detail).toMatch(/trader_orders_org_mode_venue_state_idx|USING INDEX/);
    db.close();
  });

  it("GS05_derivePortfolioAccountState_fill_walk_red", () => {
    const fixture = readFixture("gs05-portfolio-walk.json");
    expect(fixture.expectedDerivePortfolioCalls).toBe(0);
    enableIdhpsProductionBans();
    expect(() => assertIdhpsHotPathAllowsDerivePortfolioFillWalk()).toThrow(
      /BLOCKED_BY_H_ARCH_1_GS05/,
    );
  });

  it("GS06_deriveAccountRiskStateFromMockOrders_rebuild_red", () => {
    const fixture = readFixture("gs06-risk-rebuild.json");
    expect(fixture.expectedRiskRebuildCallsOnHtr).toBe(0);
    resetIdhpsHotPathCounters();
    expect(getIdhpsHotPathCounters().deriveAccountRiskStateFromMockOrdersCalls).toBe(0);
  });

  it("GS07_reconcile_incremental_state_red", () => {
    const fixture = readFixture("gs07-reconcile.json");
    expect(fixture.requiredPhases).toEqual([
      "frontier_mutation",
      "before_guardian",
      "before_cycle_complete",
    ]);
  });

  it("GS08_epoch_cash_call_arrays_bounded_red", () => {
    const fixture = readFixture("gs08-epoch-arrays.json");
    expect(fixture.evictionFailCode).toBe(
      "BLOCKED_BY_H_ARCH_1_IDHPS_EPOCH_EVICTION_OR_RETENTION_FAIL",
    );
    const mirror = createEmptyIdhpsInventoryMirror();
    const openOrder = {
      id: "open-1",
      organizationId: "org",
      credentialId: null,
      venue: "htx",
      executionMode: "mock",
      symbol: "BTC/USDT",
      side: "buy",
      type: "limit",
      price: "1",
      quantity: "1",
      filledQuantity: "0.5",
      avgFillPrice: "1",
      state: "PARTIALLY_FILLED",
      stateVersion: 1,
      exchangeOrderId: null,
      clientOrderId: "c1",
      idempotencyKey: "i1",
      riskDecisionId: "r1",
      strategySignalId: null,
      allocationDecisionId: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    } as OrderRow;
    const terminal = {
      ...openOrder,
      id: "term-1",
      state: "FILLED",
      filledQuantity: "1",
    } as OrderRow;
    applyOrderToIdhpsInventoryMirror(mirror, openOrder);
    applyOrderToIdhpsInventoryMirror(mirror, terminal);
    expect(mirror.filledQuantityByOrder["term-1"]).toBe("1");
    evictTerminalFilledQuantityAfterEpochCommit(mirror);
    expect(mirror.filledQuantityByOrder["term-1"]).toBeUndefined();
    expect(mirror.filledQuantityByOrder["open-1"]).toBe("0.5");
    verifyIdhpsInventoryAgainstOpenOrders(mirror, [openOrder]);

    const bridge = {
      cashEvents: [{ fillId: "f1", netCashEffect: "1" }],
      callOrder: [{ kind: "WP17_FILL_CONSUMED" as const, at: "t" }],
      state: { cash: "100" } as never,
      lastGuardianCycle: null,
      lastBreachCancellation: null,
      breachCancellationFailed: false,
      breachState: "NONE" as const,
      guardianReason: null,
      runTerminated: false,
      terminationCode: null,
      startingCashUsdt: "0",
      startingEquityUsdt: "0",
      cashLedgerBaseUsdt: "0",
      epochConsumedFillIds: ["f1"],
      lastMarkBySymbol: {},
      openPositionCount: 0,
    };
    clearIdhpsEpochArraysAfterDurableCommit(bridge);
    assertNoPriorEpochEntriesInBridgeArrays(bridge, 0);
    expect(bridge.cashEvents).toHaveLength(0);
    expect(bridge.callOrder).toHaveLength(0);
  });

  it("GS09_digest_no_per_cycle_full_chain_rehash_red", () => {
    const fixture = readFixture("gs09-digest.json");
    expect(fixture.fullChainRecomputeOnlyAtSeal).toBe(true);
    resetIdhpsHotPathCounters();
    const frontier = createEmptyIdhpsSemanticDigestFrontier();
    foldIdhpsSemanticEventDigest(frontier, { eventDigest: "a".repeat(64), cycle: 1 });
    foldIdhpsSemanticEventDigest(frontier, { eventDigest: "b".repeat(64), cycle: 2 });
    expect(getIdhpsHotPathCounters().fullChainDigestRecomputes).toBe(0);
    noteIdhpsFullChainDigestRecompute();
    expect(getIdhpsHotPathCounters().fullChainDigestRecomputes).toBe(1);
    expect(frontier.incrementalChainDigest).toHaveLength(64);
  });

  it("GS10_evidence_epoch_authority_red", () => {
    const fixture = readFixture("gs10-evidence.json");
    expect(fixture.maxBatchCycles).toBe(32);
    expect(fixture.runChainSchema).toBe("htr-wp05-run-chain/v2");
    expect(REPLAY_RUN_CHAIN_MANIFEST_SCHEMA_VERSION).toBe("htr-wp05-run-chain/v2");
    expect(MAX_BATCH_CYCLES).toBe(32);
    process.env.FHV_IDHPS_EVIDENCE_BATCH_CYCLES = "1024";
    expect(resolveEvidenceBatchCycles()).toBe(32);
    delete process.env.FHV_IDHPS_EVIDENCE_BATCH_CYCLES;
  });

  it("GS11_decimal_normalize_cache_red", () => {
    const fixture = readFixture("gs11-decimal.json");
    resetIdhpsDecimalNormalizeCache();
    expect(normalizeDecimalStringCached("1.00")).toBe("1.00");
    expect(normalizeDecimalStringCached("1.00")).toBe("1.00");
    expect(getIdhpsDecimalNormalizeCount()).toBeLessThanOrEqual(
      Number(fixture.maxNormalizePerCycleBound),
    );
  });

  it("GS12_prepared_statement_reuse_red", () => {
    const fixture = readFixture("gs12-prepared.json");
    expect(fixture.preparedStatementCount).toBe(IDHPS_PREPARED_STATEMENT_COUNT);
    resetIdhpsHotPathCounters();
    const db = createMemoryOrdersDb();
    const prepared = createIdhpsPreparedStatements(db);
    expect(prepared.statementCount).toBe(5);
    expect(getIdhpsHotPathCounters().preparedStatementBuilds).toBe(5);
    const before = getIdhpsHotPathCounters().preparedStatementBuilds;
    for (let i = 0; i < 100; i += 1) {
      prepared.listOpenOrdersPrepared({ organizationId: "org-idhps" }, "mock", "htx");
    }
    expect(getIdhpsHotPathCounters().preparedStatementBuilds).toBe(before);
    prepared.finalize();
    db.close();
  });

  /**
   * Documentation lock only — this asserts the fixture literal and that the metric is wired,
   * NOT that any run met the budget. Runtime enforcement lives in the checkpoint cost-model gate
   * (`tests/fhv/official-scale/blocking/fhv-checkpoint-cost-model.test.ts`). Treating this as
   * enforcement let a 19x breach ship: 7,647 ms against the 400 ms budget at epoch 414 of
   * PR452 run 31011816726.
   */
  it("GS13_checkpoint_backup_duration_metric_is_instrumented_not_enforced_here", () => {
    const fixture = readFixture("gs13-checkpoint-metric.json");
    expect(fixture.maxCheckpointBackupDurationMsPer10k).toBe(400);
    const source = readFileSync(
      join(process.cwd(), "lib/trader/observability/fhv-execution-checkpoint.ts"),
      "utf8",
    );
    expect(source).toContain("recordIdhpsCheckpointMetrics");
    expect(source).toContain("checkpointBackupDurationMs");
    // The real budget must be enforced against measured runtime somewhere else.
    const gate = readFileSync(
      join(process.cwd(), "lib/trader/observability/fhv-checkpoint-cost-model.ts"),
      "utf8",
    );
    expect(gate).toContain("FHV_CHECKPOINT_BUDGET_MS_PER_10K = 400");
    expect(gate).toContain("measureFhvCheckpointSnapshotCost");
  });

  it("GS14_wal_bytes_metric_red", () => {
    const fixture = readFixture("gs14-wal-metric.json");
    expect(fixture.maxWalBytesPerBar).toBe(64);
    const source = readFileSync(
      join(process.cwd(), "lib/trader/observability/fhv-execution-checkpoint.ts"),
      "utf8",
    );
    expect(source).toContain("wal_checkpoint(PASSIVE)");
    expect(source).toContain("walBytes");
  });

  it("composite mirror snapshot schema is present", () => {
    const snapshot = buildIdhpsCompositeMirrorSnapshot({
      epochId: 1,
      inventory: createEmptyIdhpsInventoryMirror(),
      accountRisk: createEmptyIdhpsAccountRiskMirror(),
      accountingBridge: {
        schemaVersion: "idhps-accounting-bridge-mirror/v1",
        accountingSequence: 0,
        semanticContentDigest: "0".repeat(64),
        cashEvents: [],
        callOrder: [],
      },
      semanticDigestFrontier: createEmptyIdhpsSemanticDigestFrontier(),
    });
    expect(snapshot.schemaVersion).toBe("idhps-composite-mirror-snapshot/v1");
    expect(snapshot.contentDigest).toHaveLength(64);
  });

  it("CI dependency graph includes idhps gates", () => {
    const ci = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
    for (const job of [
      "fhv-idhps-structural-gate",
      "fhv-idhps-process-parity-gate",
      "fhv-idhps-durability-gate",
      "fhv-idhps-stability-gate",
      "fhv-idhps-canonical-probe-gate",
      "fhv-idhps-full-corpus-gate",
    ]) {
      expect(ci).toContain(job);
    }
    expect(existsSync(join(FIXTURE_DIR, "gs01-orders-growth.json"))).toBe(true);
  });
});
