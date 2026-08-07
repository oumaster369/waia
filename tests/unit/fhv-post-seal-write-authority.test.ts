/**
 * WP-6A OPTION_E — post-seal write authority (cases A–E).
 *
 * Once an economically sealed order is pruned from `session.sqlite`, `recordFill` can no longer
 * find its parent and the old `trader_fills` idempotency index is gone. Sealed history must take
 * over so a duplicate delivery stays idempotent, a conflicting payload fails closed, and a
 * genuinely new post-seal economic event terminates the run rather than silently reopening it.
 */
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  raiseFhvEconomicSealBreach,
  resolveFhvPostSealFillOutcome,
} from "@/lib/trader/execution/fhv-post-seal-write-authority";
import {
  closeIdhpsSession,
  openIdhpsSession,
  setIdhpsSealedAuthority,
} from "@/lib/trader/execution/idhps-session-registry";
import type { RecordFillInput } from "@/lib/trader/execution/order-repository.types";
import {
  openFhvVerifiedEconomicLedgerSnapshot,
  sealFhvEconomicLedgerEpoch,
} from "@/lib/trader/observability/fhv-economic-ledger";
import {
  computeFhvFillIdentityCommitment,
  EconomicSealBreachError,
  FHV_ECONOMIC_SEAL_SCHEMA,
  openFhvSealedOrderRegistry,
  publishFhvEconomicSeals,
  SealedLedgerScopeViolationError,
} from "@/lib/trader/observability/fhv-economic-seal";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG = "00000000-0000-4000-8000-000000000436";
const RUN = "fhv-post-seal-run";
const SESSION = "generation-1";
const ORDER_ID = "order-sealed-1";
const TRADE_ID = "trade-1";
const EXECUTED_AT_MS = 1_577_836_800_000;

const dirs: string[] = [];
let openedSession = false;

function makeRunDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fhv-post-seal-"));
  dirs.push(dir);
  return dir;
}

function fillRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    __rowid: 1,
    id: "fill-1",
    organization_id: ORG,
    order_id: ORDER_ID,
    exchange_trade_id: TRADE_ID,
    price: "65000.00",
    quantity: "0.01",
    fee: "0.65",
    fee_asset: "USDT",
    executed_at: EXECUTED_AT_MS,
    created_at: EXECUTED_AT_MS,
    ...overrides,
  };
}

function orderRow(): Record<string, unknown> {
  return {
    __rowid: 1,
    id: ORDER_ID,
    organization_id: ORG,
    credential_id: null,
    venue: "htx",
    execution_mode: "mock",
    symbol: "BTC/USDT",
    side: "buy",
    type: "market",
    price: null,
    quantity: "0.01",
    filled_quantity: "0.01",
    avg_fill_price: "65000.00",
    state: "FILLED",
    state_version: 3,
    exchange_order_id: null,
    client_order_id: "client-1",
    idempotency_key: "idem-1",
    risk_decision_id: "risk-1",
    strategy_signal_id: null,
    allocation_decision_id: null,
    created_at: EXECUTED_AT_MS,
    updated_at: EXECUTED_AT_MS,
  };
}

function candidate(overrides: Partial<RecordFillInput> = {}): RecordFillInput {
  return {
    orderId: ORDER_ID,
    exchangeTradeId: TRADE_ID,
    price: "65000.00",
    quantity: "0.01",
    fee: "0.65",
    feeAsset: "USDT",
    executedAt: new Date(EXECUTED_AT_MS),
    ...overrides,
  };
}

/** Seal one order with one fill, then publish the run-scoped sealed authority. */
function sealRun(runDir: string, fills: Record<string, unknown>[] = [fillRow()]): void {
  sealFhvEconomicLedgerEpoch({
    runDir,
    epochId: 0,
    rows: [
      { kind: "trader_orders", row: orderRow() },
      ...fills.map((row) => ({ kind: "trader_fills" as const, row })),
    ],
  });
  publishFhvEconomicSeals({
    runDir,
    organizationId: ORG,
    runId: RUN,
    sessionIdentity: SESSION,
    seals: [
      {
        schemaVersion: FHV_ECONOMIC_SEAL_SCHEMA,
        organizationId: ORG,
        runId: RUN,
        sessionIdentity: SESSION,
        orderId: ORDER_ID,
        executionMode: "mock",
        finalObservedOrderState: "FILLED",
        finalQuantity: "0.01",
        finalFilledQuantity: "0.01",
        finalAvgFillPrice: "65000.00",
        lastOrderEventSeq: 3,
        fillIdentityCommitment: computeFhvFillIdentityCommitment(
          fills.map((row) => String(row.id)),
          fills.map((row) => String(row.exchange_trade_id)),
        ),
        fillIds: fills.map((row) => String(row.id)),
        exchangeTradeIds: fills.map((row) => String(row.exchange_trade_id)),
        accountingFrontierSequence: 10,
        sourceFrontierGlobalEventSequence: 10_000,
        owningEpochId: 0,
        owningLastCycle: 9_999,
        ledgerSegmentSeq: 0,
        ledgerChainDigest: "c".repeat(64),
        economicExportDigest: "e".repeat(64),
        sealedAtReplayMs: EXECUTED_AT_MS,
        sealingReason: "EPOCH_COMMIT_ECONOMICALLY_COMPLETE",
        reconciliationProofIdentity: "r".repeat(64),
      },
    ],
  });

  // The IDHPS session prepares statements against these tables; the post-seal path under test
  // exercises the case where they are empty because the rows were pruned after sealing.
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
  openIdhpsSession(sqlite, { enableBans: false });
  openedSession = true;
  setIdhpsSealedAuthority({
    registry: openFhvSealedOrderRegistry({ runDir, organizationId: ORG, runId: RUN }),
    snapshot: openFhvVerifiedEconomicLedgerSnapshot(runDir),
  });
}

afterEach(() => {
  if (openedSession) {
    closeIdhpsSession();
    openedSession = false;
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("WP-6A post-seal write authority", () => {
  it("CASE E: no session authority leaves OrderNotFound to the caller", () => {
    const outcome = resolveFhvPostSealFillOutcome({
      context: requireOrgContext(ORG),
      orderId: ORDER_ID,
      exchangeTradeId: TRADE_ID,
      candidate: candidate(),
    });
    expect(outcome.kind).toBe("NO_SEALED_ORDER");
  });

  it("CASE E: an unknown parent is not resolved from the sealed registry", () => {
    sealRun(makeRunDir());
    const outcome = resolveFhvPostSealFillOutcome({
      context: requireOrgContext(ORG),
      orderId: "order-never-existed",
      exchangeTradeId: TRADE_ID,
      candidate: candidate({ orderId: "order-never-existed" }),
    });
    expect(outcome.kind).toBe("NO_SEALED_ORDER");
  });

  it("CASE B: an exact duplicate after pruning resolves idempotently", () => {
    sealRun(makeRunDir());
    const outcome = resolveFhvPostSealFillOutcome({
      context: requireOrgContext(ORG),
      orderId: ORDER_ID,
      exchangeTradeId: TRADE_ID,
      candidate: candidate(),
    });
    expect(outcome.kind).toBe("IDEMPOTENT_DUPLICATE");
    if (outcome.kind !== "IDEMPOTENT_DUPLICATE") return;
    // The canonical prior fill is returned verbatim: exact decimals and exact Date.
    expect(outcome.fill.id).toBe("fill-1");
    expect(outcome.fill.price).toBe("65000.00");
    expect(outcome.fill.quantity).toBe("0.01");
    expect(outcome.fill.fee).toBe("0.65");
    expect(outcome.fill.feeAsset).toBe("USDT");
    expect(outcome.fill.executedAt.getTime()).toBe(EXECUTED_AT_MS);
    expect(outcome.fill.executedAt).toBeInstanceOf(Date);
  });

  it("CASE C: same fill identity with a different payload fails closed", () => {
    sealRun(makeRunDir());
    for (const conflicting of [
      candidate({ price: "65000.01" }),
      candidate({ quantity: "0.02" }),
      candidate({ fee: "0.66" }),
      candidate({ executedAt: new Date(EXECUTED_AT_MS + 1) }),
    ]) {
      const outcome = resolveFhvPostSealFillOutcome({
        context: requireOrgContext(ORG),
        orderId: ORDER_ID,
        exchangeTradeId: TRADE_ID,
        candidate: conflicting,
      });
      expect(outcome.kind).toBe("PAYLOAD_CONFLICT");
    }
  });

  it("CASE D: a genuinely new fill against a sealed order is a seal breach", () => {
    sealRun(makeRunDir());
    const outcome = resolveFhvPostSealFillOutcome({
      context: requireOrgContext(ORG),
      orderId: ORDER_ID,
      exchangeTradeId: "trade-brand-new",
      candidate: candidate({ exchangeTradeId: "trade-brand-new" }),
    });
    expect(outcome.kind).toBe("SEAL_BREACH");
  });

  it("CASE D: the breach terminates the run and throws fail-closed", () => {
    const codes: string[] = [];
    expect(() =>
      raiseFhvEconomicSealBreach({
        orderId: ORDER_ID,
        exchangeTradeId: "trade-brand-new",
        detail: "new fill against an economically sealed order",
        terminate: (code) => codes.push(code),
      }),
    ).toThrow(EconomicSealBreachError);
    expect(codes).toEqual(["ECONOMIC_SEAL_BREACH_RECONCILIATION_REQUIRED"]);
  });

  it("CASE D: a termination failure never swallows the breach", () => {
    expect(() =>
      raiseFhvEconomicSealBreach({
        orderId: ORDER_ID,
        exchangeTradeId: "trade-brand-new",
        detail: "detail",
        terminate: () => {
          throw new Error("bridge unavailable");
        },
      }),
    ).toThrow(EconomicSealBreachError);
  });

  it("a cross-tenant read fails closed before any lookup", () => {
    sealRun(makeRunDir());
    expect(() =>
      resolveFhvPostSealFillOutcome({
        context: requireOrgContext("00000000-0000-4000-8000-000000000999"),
        orderId: ORDER_ID,
        exchangeTradeId: TRADE_ID,
        candidate: candidate(),
      }),
    ).toThrow(SealedLedgerScopeViolationError);
  });

  it("a wrong run identity cannot open the sealed registry", () => {
    const runDir = makeRunDir();
    sealRun(runDir);
    expect(() =>
      openFhvSealedOrderRegistry({ runDir, organizationId: ORG, runId: "some-other-run" }),
    ).toThrow(SealedLedgerScopeViolationError);
  });

  it("resolves multi-fill sealed orders by exact trade identity", () => {
    sealRun(makeRunDir(), [
      fillRow(),
      fillRow({ id: "fill-2", exchange_trade_id: "trade-2", quantity: "0.02", __rowid: 2 }),
    ]);

    const second = resolveFhvPostSealFillOutcome({
      context: requireOrgContext(ORG),
      orderId: ORDER_ID,
      exchangeTradeId: "trade-2",
      candidate: candidate({ exchangeTradeId: "trade-2", quantity: "0.02" }),
    });
    expect(second.kind).toBe("IDEMPOTENT_DUPLICATE");

    const mismatched = resolveFhvPostSealFillOutcome({
      context: requireOrgContext(ORG),
      orderId: ORDER_ID,
      exchangeTradeId: "trade-2",
      candidate: candidate({ exchangeTradeId: "trade-2", quantity: "0.03" }),
    });
    expect(mismatched.kind).toBe("PAYLOAD_CONFLICT");
  });

  it("verifies the ledger once and answers later lookups from the index", () => {
    const runDir = makeRunDir();
    sealRun(runDir);
    const snapshot = openFhvVerifiedEconomicLedgerSnapshot(runDir);
    expect(snapshot.segmentCount).toBe(1);

    // Repeated resolution must not rescan or rehash; it is an indexed map hit.
    const startedAt = performance.now();
    for (let index = 0; index < 2_000; index += 1) {
      resolveFhvPostSealFillOutcome({
        context: requireOrgContext(ORG),
        orderId: ORDER_ID,
        exchangeTradeId: TRADE_ID,
        candidate: candidate(),
      });
    }
    const perLookupMs = (performance.now() - startedAt) / 2_000;
    expect(perLookupMs).toBeLessThan(1);
  });
});
