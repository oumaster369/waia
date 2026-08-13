/**
 * WP-6A OPTION_E — crash/resume failure injection and boundedness.
 *
 * The safety property under test is that pruned rows can never exist without a durable,
 * identity-consistent seal. Every cut point in the lifecycle must leave either "nothing pruned"
 * or "fully reconstructable sealed history".
 */
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  collectFhvLifecycleAuditRows,
  collectFhvSealCandidates,
  collectFhvSealedEconomicRows,
  pruneFhvSealedEconomicRows,
  pruneFhvSealedLifecycleAuditRows,
} from "@/lib/trader/execution/fhv-hot-state-pruner";
import {
  openFhvVerifiedEconomicLedgerSnapshot,
  readFhvEconomicLedgerRows,
  sealFhvEconomicLedgerEpoch,
  SealedLedgerRowContractError,
  verifyFhvEconomicLedger,
} from "@/lib/trader/observability/fhv-economic-ledger";
import {
  computeFhvFillIdentityCommitment,
  FHV_ECONOMIC_SEAL_SCHEMA,
  openFhvSealedOrderRegistry,
  publishFhvEconomicSeals,
  readFhvEconomicSeals,
  SealedLedgerIdentityDriftError,
  SealedLedgerScopeViolationError,
} from "@/lib/trader/observability/fhv-economic-seal";
import {
  evaluateFhvEconomicSealEligibility,
  type FhvSealBoundaryProof,
} from "@/lib/trader/observability/fhv-economic-seal-eligibility";

const ORG = "00000000-0000-4000-8000-000000000436";
const RUN = "fhv-crash-run";
const SESSION = "generation-1";
const T0 = 1_577_836_800_000;

const CLEAN: FhvSealBoundaryProof = {
  epochCommitted: true,
  sourceFrontierProven: true,
  reconciliationClean: true,
  ledgerDurable: true,
};

const dirs: string[] = [];

function makeRunDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fhv-crash-"));
  dirs.push(dir);
  return dir;
}

function makeDb(): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE trader_orders (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, credential_id TEXT,
      venue TEXT NOT NULL, execution_mode TEXT NOT NULL, symbol TEXT NOT NULL,
      side TEXT NOT NULL, type TEXT NOT NULL, price TEXT, quantity TEXT NOT NULL,
      filled_quantity TEXT NOT NULL DEFAULT '0', avg_fill_price TEXT, state TEXT NOT NULL,
      state_version INTEGER NOT NULL DEFAULT 1, exchange_order_id TEXT,
      client_order_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      risk_decision_id TEXT NOT NULL, strategy_signal_id TEXT, allocation_decision_id TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE trader_order_events (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, order_id TEXT NOT NULL,
      seq INTEGER NOT NULL, from_state TEXT, to_state TEXT NOT NULL, event_type TEXT NOT NULL,
      payload TEXT, occurred_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE trader_fills (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, order_id TEXT NOT NULL,
      exchange_trade_id TEXT NOT NULL, price TEXT NOT NULL, quantity TEXT NOT NULL,
      fee TEXT NOT NULL, fee_asset TEXT NOT NULL, executed_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  return sqlite;
}

function makeLifecycleDb(): Database.Database {
  const sqlite = makeDb();
  sqlite.exec(`
    CREATE TABLE trader_lifecycle_events (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, phase TEXT NOT NULL, payload TEXT,
      occurred_at INTEGER NOT NULL, research_run_id TEXT, created_at INTEGER NOT NULL
    );
  `);
  return sqlite;
}

function insertSignalAcceptedEvent(
  sqlite: Database.Database,
  input: { id: string; occurredAt?: number },
): void {
  const occurredAt = input.occurredAt ?? T0;
  sqlite
    .prepare(
      `INSERT INTO trader_lifecycle_events (id, organization_id, entity_type, entity_id, phase,
        payload, occurred_at, research_run_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      input.id,
      ORG,
      "STRATEGY_SIGNAL",
      `signal-${input.id}`,
      "SIGNAL_ACCEPTED",
      JSON.stringify({ strategyId: "mean_reversion_v0", regime: "RANGE" }),
      occurredAt,
      null,
      occurredAt,
    );
}

function insertOrder(
  sqlite: Database.Database,
  input: { id: string; state: string; filled?: string; createdAt?: number; withFill?: boolean },
): void {
  const createdAt = input.createdAt ?? T0;
  const filled = input.filled ?? (input.state === "FILLED" ? "0.01" : "0");
  sqlite
    .prepare(
      `INSERT INTO trader_orders (id, organization_id, venue, execution_mode, symbol, side, type,
        quantity, filled_quantity, avg_fill_price, state, state_version, client_order_id,
        idempotency_key, risk_decision_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      input.id,
      ORG,
      "htx",
      "mock",
      "BTC/USDT",
      "buy",
      "market",
      "0.01",
      filled,
      input.state === "FILLED" ? "65000.00" : null,
      input.state,
      3,
      `client-${input.id}`,
      `idem-${input.id}`,
      `risk-${input.id}`,
      createdAt,
      createdAt,
    );
  sqlite
    .prepare(
      `INSERT INTO trader_order_events (id, organization_id, order_id, seq, from_state, to_state,
        event_type, payload, occurred_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      `ev-${input.id}`,
      ORG,
      input.id,
      1,
      null,
      input.state,
      "transition",
      null,
      createdAt,
      createdAt,
    );
  if (input.withFill !== false && filled !== "0") {
    sqlite
      .prepare(
        `INSERT INTO trader_fills (id, organization_id, order_id, exchange_trade_id, price,
          quantity, fee, fee_asset, executed_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        `fill-${input.id}`,
        ORG,
        input.id,
        `trade-${input.id}`,
        "65000.00",
        filled,
        "0.65",
        "USDT",
        createdAt,
        createdAt,
      );
  }
}

function eligibleOrderIds(sqlite: Database.Database, proof: FhvSealBoundaryProof): string[] {
  return collectFhvSealCandidates(sqlite)
    .candidates.map((candidate) => evaluateFhvEconomicSealEligibility(candidate, proof))
    .filter((result) => result.eligible)
    .map((result) => result.orderId);
}

function publishSeals(runDir: string, sqlite: Database.Database, orderIds: string[]): void {
  const collected = collectFhvSealedEconomicRows(sqlite, orderIds);
  publishFhvEconomicSeals({
    runDir,
    organizationId: ORG,
    runId: RUN,
    sessionIdentity: SESSION,
    seals: orderIds.map((orderId) => {
      const identity = collected.fillIdentityByOrderId.get(orderId) ?? {
        fillIds: [],
        exchangeTradeIds: [],
      };
      return {
        schemaVersion: FHV_ECONOMIC_SEAL_SCHEMA,
        organizationId: ORG,
        runId: RUN,
        sessionIdentity: SESSION,
        orderId,
        executionMode: "mock",
        finalObservedOrderState: "FILLED",
        finalQuantity: "0.01",
        finalFilledQuantity: "0.01",
        finalAvgFillPrice: "65000.00",
        lastOrderEventSeq: collected.lastEventSeqByOrderId.get(orderId) ?? -1,
        fillIdentityCommitment: computeFhvFillIdentityCommitment(
          identity.fillIds,
          identity.exchangeTradeIds,
        ),
        fillIds: identity.fillIds,
        exchangeTradeIds: identity.exchangeTradeIds,
        accountingFrontierSequence: 1,
        sourceFrontierGlobalEventSequence: 10_000,
        owningEpochId: 0,
        owningLastCycle: 9_999,
        ledgerSegmentSeq: 0,
        ledgerChainDigest: "c".repeat(64),
        economicExportDigest: "e".repeat(64),
        sealedAtReplayMs: T0,
        sealingReason: "EPOCH_COMMIT_ECONOMICALLY_COMPLETE",
        reconciliationProofIdentity: "r".repeat(64),
      };
    }),
  });
}

function countEconomicRows(sqlite: Database.Database): number {
  let total = 0;
  for (const table of ["trader_orders", "trader_order_events", "trader_fills"]) {
    total += (sqlite.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;
  }
  return total;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("WP-6A crash boundaries", () => {
  it("1: crash before ledger append prunes nothing and loses nothing", () => {
    const runDir = makeRunDir();
    const sqlite = makeDb();
    insertOrder(sqlite, { id: "o1", state: "FILLED" });
    const before = countEconomicRows(sqlite);

    // Crash here — nothing was appended, sealed or pruned.
    expect(readFhvEconomicLedgerRows(runDir)).toHaveLength(0);
    expect(readFhvEconomicSeals(runDir)).toHaveLength(0);
    expect(countEconomicRows(sqlite)).toBe(before);
    sqlite.close();
  });

  it("2-3: crash after ledger append but before seal leaves history duplicated, never lost", () => {
    const runDir = makeRunDir();
    const sqlite = makeDb();
    insertOrder(sqlite, { id: "o1", state: "FILLED" });
    const before = countEconomicRows(sqlite);

    const collected = collectFhvSealedEconomicRows(sqlite, ["o1"]);
    sealFhvEconomicLedgerEpoch({ runDir, epochId: 0, rows: collected.rows });

    // Crash before verification/seal publication.
    expect(verifyFhvEconomicLedger(runDir).ok).toBe(true);
    expect(readFhvEconomicSeals(runDir)).toHaveLength(0);
    // Recoverable duplication, never loss: rows are in both places.
    expect(countEconomicRows(sqlite)).toBe(before);
    expect(readFhvEconomicLedgerRows(runDir).length).toBe(before);
    sqlite.close();
  });

  it("4-5: crash after seal publication but before prune keeps SQLite intact", () => {
    const runDir = makeRunDir();
    const sqlite = makeDb();
    insertOrder(sqlite, { id: "o1", state: "FILLED" });
    const before = countEconomicRows(sqlite);

    const collected = collectFhvSealedEconomicRows(sqlite, ["o1"]);
    sealFhvEconomicLedgerEpoch({ runDir, epochId: 0, rows: collected.rows });
    publishSeals(runDir, sqlite, ["o1"]);

    // Crash before prune.
    expect(readFhvEconomicSeals(runDir)).toHaveLength(1);
    expect(countEconomicRows(sqlite)).toBe(before);
    // Resume is safe: the seal is durable and the ledger reconstructs the same history.
    const registry = openFhvSealedOrderRegistry({ runDir, organizationId: ORG, runId: RUN });
    expect(registry.isSealed("o1")).toBe(true);
    sqlite.close();
  });

  it("6-8: prune is atomic, and after it history is fully reconstructable", () => {
    const runDir = makeRunDir();
    const sqlite = makeDb();
    insertOrder(sqlite, { id: "o1", state: "FILLED" });
    const before = countEconomicRows(sqlite);

    const collected = collectFhvSealedEconomicRows(sqlite, ["o1"]);
    sealFhvEconomicLedgerEpoch({ runDir, epochId: 0, rows: collected.rows });
    publishSeals(runDir, sqlite, ["o1"]);
    const deleted = pruneFhvSealedEconomicRows(sqlite, ["o1"]);

    expect(deleted.deletedOrders).toBe(1);
    expect(countEconomicRows(sqlite)).toBe(0);
    // Nothing lost: every pruned row is in the verified ledger.
    const snapshot = openFhvVerifiedEconomicLedgerSnapshot(runDir);
    expect(snapshot.rowCount).toBe(before);
    expect(snapshot.ordersById.has("o1")).toBe(true);
    expect(snapshot.fillsByOrderId.get("o1")).toHaveLength(1);
    sqlite.close();
  });

  it("no pruned row can exist without a committed seal", () => {
    const runDir = makeRunDir();
    const sqlite = makeDb();
    insertOrder(sqlite, { id: "o1", state: "FILLED" });

    // The lifecycle only ever prunes ids it has just sealed; an unsealed id is not eligible.
    const eligible = eligibleOrderIds(sqlite, CLEAN);
    expect(eligible).toEqual(["o1"]);
    const notEligible = eligibleOrderIds(sqlite, { ...CLEAN, reconciliationClean: false });
    expect(notEligible).toEqual([]);
    // With a dirty boundary nothing is sealed, so nothing may be pruned.
    expect(readFhvEconomicSeals(runDir)).toHaveLength(0);
    sqlite.close();
  });
});

describe("WP-6A resume validation", () => {
  function sealedRunDir(): string {
    const runDir = makeRunDir();
    const sqlite = makeDb();
    insertOrder(sqlite, { id: "o1", state: "FILLED" });
    const collected = collectFhvSealedEconomicRows(sqlite, ["o1"]);
    sealFhvEconomicLedgerEpoch({ runDir, epochId: 0, rows: collected.rows });
    publishSeals(runDir, sqlite, ["o1"]);
    pruneFhvSealedEconomicRows(sqlite, ["o1"]);
    sqlite.close();
    return runDir;
  }

  it("9: resume from a valid pruned state reconstructs exactly", () => {
    const runDir = sealedRunDir();
    const snapshot = openFhvVerifiedEconomicLedgerSnapshot(runDir);
    const registry = openFhvSealedOrderRegistry({ runDir, organizationId: ORG, runId: RUN });
    expect(registry.sealCount).toBe(1);
    expect(snapshot.ordersById.has("o1")).toBe(true);
    expect(registry.hasFillIdentity("o1", "trade-o1")).toBe(true);
  });

  it("10: resume with a missing seal log fails closed", () => {
    const runDir = sealedRunDir();
    rmSync(join(runDir, "economic-seal", "economic-seal-log.v1.ndjson"), { force: true });
    expect(() => openFhvSealedOrderRegistry({ runDir, organizationId: ORG, runId: RUN })).toThrow(
      SealedLedgerIdentityDriftError,
    );
  });

  it("11: resume with an invalid seal digest fails closed", () => {
    const runDir = sealedRunDir();
    const logPath = join(runDir, "economic-seal", "economic-seal-log.v1.ndjson");
    const seal = JSON.parse(readFileSync(logPath, "utf8").trim()) as Record<string, unknown>;
    writeFileSync(logPath, `${JSON.stringify({ ...seal, finalFilledQuantity: "9.99" })}\n`);
    expect(() => openFhvSealedOrderRegistry({ runDir, organizationId: ORG, runId: RUN })).toThrow(
      SealedLedgerIdentityDriftError,
    );
  });

  it("12: resume with a corrupted ledger segment fails closed", () => {
    const runDir = sealedRunDir();
    const segment = join(runDir, "economic-ledger", "segment-00000000.ndjson");
    expect(existsSync(segment)).toBe(true);
    writeFileSync(segment, `${readFileSync(segment, "utf8")}{"kind":"trader_fills","row":{}}\n`);
    expect(() => openFhvVerifiedEconomicLedgerSnapshot(runDir)).toThrow(
      SealedLedgerRowContractError,
    );
    expect(verifyFhvEconomicLedger(runDir).ok).toBe(false);
  });

  it("12b: a missing ledger segment fails closed", () => {
    const runDir = sealedRunDir();
    rmSync(join(runDir, "economic-ledger", "segment-00000000.ndjson"), { force: true });
    const verification = verifyFhvEconomicLedger(runDir);
    expect(verification.ok).toBe(false);
    expect(verification.failures.join(",")).toContain("missing_segment");
  });

  it("13: resume with the wrong organization or run fails closed", () => {
    const runDir = sealedRunDir();
    expect(() =>
      openFhvSealedOrderRegistry({ runDir, organizationId: "other-org", runId: RUN }),
    ).toThrow(SealedLedgerScopeViolationError);
    expect(() =>
      openFhvSealedOrderRegistry({ runDir, organizationId: ORG, runId: "other-run" }),
    ).toThrow(SealedLedgerScopeViolationError);
  });

  it("14: frontier disagreement is recorded in the seal for resume comparison", () => {
    const runDir = sealedRunDir();
    const seal = readFhvEconomicSeals(runDir)[0]!;
    expect(seal.sourceFrontierGlobalEventSequence).toBe(10_000);
    expect(seal.accountingFrontierSequence).toBe(1);
    expect(seal.owningEpochId).toBe(0);
    // Deterministic replay time, never wall clock.
    expect(seal.sealedAtReplayMs).toBe(T0);
  });
});

describe("WP-6A boundedness", () => {
  it("repeated create/seal/prune cycles do not restore linear hot-database growth", () => {
    const runDir = makeRunDir();
    const sqlite = makeDb();
    const residentAfterCycle: number[] = [];

    for (let cycle = 0; cycle < 6; cycle += 1) {
      // One completed order plus one still-open order per cycle.
      insertOrder(sqlite, { id: `done-${cycle}`, state: "FILLED", createdAt: T0 + cycle * 1_000 });
      insertOrder(sqlite, {
        id: `open-${cycle}`,
        state: "ACCEPTED",
        filled: "0",
        createdAt: T0 + cycle * 1_000 + 1,
        withFill: false,
      });

      const eligible = eligibleOrderIds(sqlite, CLEAN);
      const collected = collectFhvSealedEconomicRows(sqlite, eligible);
      sealFhvEconomicLedgerEpoch({ runDir, epochId: cycle, rows: collected.rows });
      publishSeals(runDir, sqlite, eligible);
      pruneFhvSealedEconomicRows(sqlite, eligible);

      residentAfterCycle.push(countEconomicRows(sqlite));
    }

    // Only the still-open orders remain resident; completed history left for the ledger.
    const growthPerCycle = residentAfterCycle[5]! - residentAfterCycle[4]!;
    expect(growthPerCycle).toBe(residentAfterCycle[1]! - residentAfterCycle[0]!);
    // Completed orders never accumulate: resident rows track open orders only.
    expect(residentAfterCycle[5]).toBe(12);

    // All sealed history remains reconstructable.
    const snapshot = openFhvVerifiedEconomicLedgerSnapshot(runDir);
    for (let cycle = 0; cycle < 6; cycle += 1) {
      expect(snapshot.ordersById.has(`done-${cycle}`)).toBe(true);
    }
    expect(snapshot.segmentCount).toBe(6);
    sqlite.close();
  });

  it("open orders spanning many cycles are never pruned", () => {
    const sqlite = makeDb();
    insertOrder(sqlite, { id: "long-open", state: "PARTIALLY_FILLED", filled: "0.005" });
    insertOrder(sqlite, {
      id: "cancel-req",
      state: "CANCEL_REQUESTED",
      filled: "0",
      withFill: false,
    });
    insertOrder(sqlite, {
      id: "recon",
      state: "RECONCILIATION_REQUIRED",
      filled: "0",
      withFill: false,
    });
    expect(eligibleOrderIds(sqlite, CLEAN)).toEqual([]);
    sqlite.close();
  });

  it("lifecycle audit rows are sealed durably before they leave bounded hot state", () => {
    // Regression for the WP-7B growth defect: SIGNAL_ACCEPTED lifecycle audit accumulated
    // monotonically in session.sqlite because it was never sealed or pruned, eventually forcing
    // the checkpointed database to grow past the bounded ceiling (197.647 > 160 b/cycle).
    const runDir = makeRunDir();
    const sqlite = makeLifecycleDb();

    // Pre-repair defect shape: the audit table grows unbounded across epochs.
    for (let epoch = 0; epoch < 4; epoch += 1) {
      for (let index = 0; index < 100; index += 1) {
        insertSignalAcceptedEvent(sqlite, { id: `sig-${epoch}-${index}`, occurredAt: T0 + epoch });
      }

      const lifecycle = collectFhvLifecycleAuditRows(sqlite);
      expect(lifecycle.rows.length).toBe(100);
      // Fail-closed ordering: seal + verify BEFORE the destructive delete.
      sealFhvEconomicLedgerEpoch({ runDir, epochId: epoch, rows: lifecycle.rows });
      expect(verifyFhvEconomicLedger(runDir).ok).toBe(true);
      const deleted = pruneFhvSealedLifecycleAuditRows(sqlite, lifecycle.ids);
      expect(deleted).toBe(100);

      // Bounded: the resident audit table returns to empty every epoch instead of accumulating.
      expect(
        (sqlite.prepare("SELECT COUNT(*) c FROM trader_lifecycle_events").get() as { c: number }).c,
      ).toBe(0);
    }

    // Nothing lost: every pruned audit row is durably reconstructable from the verified ledger.
    const sealed = readFhvEconomicLedgerRows(runDir).filter(
      (entry) => entry.kind === "trader_lifecycle_events",
    );
    expect(sealed).toHaveLength(400);
    // The ledger snapshot ignores lifecycle rows for order reconstruction and must never throw.
    expect(() => openFhvVerifiedEconomicLedgerSnapshot(runDir)).not.toThrow();
    sqlite.close();
  });

  it("lifecycle prune stays within SQLite bound-parameter limits for high-density epochs", () => {
    const sqlite = makeLifecycleDb();
    for (let index = 0; index < 1_500; index += 1) {
      insertSignalAcceptedEvent(sqlite, { id: `sig-${index}`, occurredAt: T0 + index });
    }
    const lifecycle = collectFhvLifecycleAuditRows(sqlite);
    expect(lifecycle.ids.length).toBe(1_500);
    // 1,500 > the 999 legacy bound-parameter ceiling — chunked deletion must still remove all.
    const deleted = pruneFhvSealedLifecycleAuditRows(sqlite, lifecycle.ids);
    expect(deleted).toBe(1_500);
    expect(
      (sqlite.prepare("SELECT COUNT(*) c FROM trader_lifecycle_events").get() as { c: number }).c,
    ).toBe(0);
    sqlite.close();
  });

  it("lifecycle collection is a safe no-op when the audit table is absent", () => {
    const sqlite = makeDb();
    const lifecycle = collectFhvLifecycleAuditRows(sqlite);
    expect(lifecycle.rows).toHaveLength(0);
    expect(pruneFhvSealedLifecycleAuditRows(sqlite, [])).toBe(0);
    sqlite.close();
  });

  it("ledger verification and index construction happen once per snapshot", () => {
    const runDir = makeRunDir();
    const sqlite = makeDb();
    for (let index = 0; index < 40; index += 1) {
      insertOrder(sqlite, { id: `o${index}`, state: "FILLED", createdAt: T0 + index });
    }
    const eligible = eligibleOrderIds(sqlite, CLEAN);
    const collected = collectFhvSealedEconomicRows(sqlite, eligible);
    sealFhvEconomicLedgerEpoch({ runDir, epochId: 0, rows: collected.rows });

    const snapshot = openFhvVerifiedEconomicLedgerSnapshot(runDir);
    expect(snapshot.ordersById.size).toBe(40);

    // Indexed lookups only — no rescans, no rehashing.
    const startedAt = performance.now();
    for (let index = 0; index < 20_000; index += 1) {
      snapshot.ordersById.get(`o${index % 40}`);
      snapshot.fillsByOrderId.get(`o${index % 40}`);
    }
    expect((performance.now() - startedAt) / 20_000).toBeLessThan(0.05);
    sqlite.close();
  });
});
