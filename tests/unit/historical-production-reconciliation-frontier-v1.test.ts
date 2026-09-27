import { describe, expect, it } from "vitest";
import { createInitialAccountingState, advanceAccountingFrontier } from
  "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import {
  createHistoricalReconciliationGenesisV1, advanceHistoricalReconciliationV1,
  observeHistoricalReconciliationV1, sealHistoricalReconciliationCycleV1,
  assertHistoricalReconciliationFrontierV1, projectHistoricalReconciliationAccountingV1,
  createHistoricalReconciliationBudgetV1, HISTORICAL_RECONCILIATION_PROJECTION_BYTES_V1,
} from "@/lib/trader/historical-simulation-v2/production-reconciliation-frontier-v1";
import type { AccountingFrontierV1 } from "@/lib/trader/accounting/accounting-frontier.types";
const digest = "a".repeat(64);
const scope = { organizationId: "ed996dee-79d8-4f64-8a01-83d1cdb62f5c", accountId: "account", runId: "run", split: "DEVELOPMENT" as const };
const inception = (): AccountingFrontierV1 => ({ ...createInitialAccountingState({
  organizationId: scope.organizationId, accountKey: scope.accountId, runId: scope.runId,
  startingCash: "1000", frontierAsOf: "2026-01-01T00:00:00.000Z",
}), id: "00000000-0000-4000-8000-000000000001", sourceFillId: null,
  sourceEconomicsDigest: digest, semanticContentDigest: digest, idempotencyKey: "inception" });
const genesis = () => createHistoricalReconciliationGenesisV1({ scope, symbol: "BTCUSDT",
  inception: inception(), authorityId: "00000000-0000-4000-8000-000000000003", authorityDigest: digest, modelDigest: digest, releaseSha: "a".repeat(40), initialRecordIndex: 10 });
const mark = (state = inception()) => advanceAccountingFrontier({ state,
  marks: { BTCUSDT: { price: "100", barCloseTime: "2026-01-01T00:01:00.000Z" } },
  frontierAsOf: "2026-01-01T00:01:00.000Z", frontierId: "00000000-0000-4000-8000-000000000002" });
const cycle = () => ({ previous: genesis(), cycleId: "cycle", cycleSequence: 0,
  recordIndex: 10, membershipDigest: digest, marketDigest: digest, releaseSha: "a".repeat(40),
  steps: [projectHistoricalReconciliationAccountingV1(mark())], fills: [], economics: [], consumed: [] });
describe("bounded historical reconciliation, real delta grammar", () => {
  it("checks actual MARK and all three fresh observations before sealing", () => {
    const delta = advanceHistoricalReconciliationV1(cycle());
    let observations: ReturnType<typeof observeHistoricalReconciliationV1>[] = [];
    for (const phase of ["frontier_mutation", "before_guardian", "before_cycle_complete"] as const) {
      observations = [...observations, observeHistoricalReconciliationV1({ delta, phase,
        accounting: projectHistoricalReconciliationAccountingV1(mark()), activeParent: null,
        touchedParents: [], previousObservations: observations })];
    }
    const saved = sealHistoricalReconciliationCycleV1({ delta, observations,
      checkpointDigest: digest, activeParent: null, touchedParents: [] });
    expect(saved.cycleSequence).toBe(0);
    expect(saved.expectedCashAfter).toBe("1000");
    expect(saved.sourceEventCount).toBe(1);
    expect(() => assertHistoricalReconciliationFrontierV1(saved, scope)).not.toThrow();
  });
  it("refuses skipped phases and no-fill cash drift", () => {
    const delta = advanceHistoricalReconciliationV1(cycle());
    const value = { delta, phase: "before_guardian" as const,
      accounting: projectHistoricalReconciliationAccountingV1(mark()), activeParent: null,
      touchedParents: [], previousObservations: [] };
    expect(() => observeHistoricalReconciliationV1(value)).toThrow("PHASE_ORDER");
    expect(() => advanceHistoricalReconciliationV1({ ...cycle(), steps: [{
      ...projectHistoricalReconciliationAccountingV1(mark()), cash: "999",
    }] })).toThrow("CASH_MISMATCH");
  });
  it("requires both directions of fill/economics/Accounting/cash identity", () => {
    expect(() => advanceHistoricalReconciliationV1({ ...cycle(), consumed: [{
      fillId: "unmatched", accountingId: "unmatched", accountingSequence: 2, accountingDigest: digest,
      economicsDigest: digest,
    }] })).toThrow("FILL_MEMBERSHIP");
  });
  it("does not scan or copy canonical historical consumed IDs", () => {
    const state = inception();
    state.consumedFillIds = new Proxy(["earlier", "last"], { get(target, key, receiver) {
      if (key === "0" || key === Symbol.iterator || key === "map" || key === "slice") throw new Error("historical scan");
      return Reflect.get(target, key, receiver);
    } });
    const projected = projectHistoricalReconciliationAccountingV1(state);
    expect(projected.consumedFillCount).toBe(2);
    expect(projected.lastConsumedFillId).toBe("last");
    expect(projected).not.toHaveProperty("consumedFillIds");
  });
  it("refuses extra position symbols even when their quantities are zero", () => {
    const state = mark();
    state.positions.ETHUSDT = { quantity: "0", grossPositionBasis: "0", netPositionBasis: "0" };
    expect(() => advanceHistoricalReconciliationV1({ ...cycle(), steps: [
      projectHistoricalReconciliationAccountingV1(state),
    ] })).toThrow("SYMBOL_SCOPE");
  });
  it("counts UTF-8 bytes before projection parse; capacity failure is sticky", () => {
    const budget = createHistoricalReconciliationBudgetV1();
    expect(() => budget.charge(HISTORICAL_RECONCILIATION_PROJECTION_BYTES_V1 + 1)).toThrow("RESOURCE_ENVELOPE");
    expect(() => budget.charge(1)).toThrow("RESOURCE_ENVELOPE");
    const exact = createHistoricalReconciliationBudgetV1();
    for (let n = 0; n < 8; n++) exact.charge(HISTORICAL_RECONCILIATION_PROJECTION_BYTES_V1);
    expect(() => exact.charge(1)).toThrow("RESOURCE_ENVELOPE");
  });
  it("refuses mutation of a sealed frontier and wrong physical scope", () => {
    const saved = genesis();
    expect(() => assertHistoricalReconciliationFrontierV1({ ...saved, expectedCashAfter: "2000" }, scope)).toThrow("DIGEST");
    expect(() => assertHistoricalReconciliationFrontierV1(saved, { ...scope, split: "WALK_FORWARD" })).toThrow("SCOPE");
  });
});

// Economic controls use the existing actual Accounting engine. These fixtures establish
// reducer consistency only; persisted source/privilege authority needs the native suite.
import { applyHistoricalExecutionEconomics } from "@/lib/trader/execution/fill-economics";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import type { HistoricalReconciliationParentV1, HistoricalReconciliationDeltaV1 } from
  "@/lib/trader/historical-simulation-v2/production-reconciliation-frontier-v1";
import { createHistoricalReconciliationRepositoryV1 } from
  "@/lib/trader/historical-simulation-v2/production-reconciliation-repository-postgres-v1";
import { vi } from "vitest";

function observations(delta: HistoricalReconciliationDeltaV1, parent: HistoricalReconciliationParentV1 | null) {
  const result: ReturnType<typeof observeHistoricalReconciliationV1>[] = [];
  for (const phase of ["frontier_mutation", "before_guardian", "before_cycle_complete"] as const) {
    result.push(observeHistoricalReconciliationV1({ delta, phase, accounting: delta.accounting,
      activeParent: parent, touchedParents: parent ? [parent] : [], previousObservations: result }));
  }
  return result;
}
function fillCycle() {
  const parent: HistoricalReconciliationParentV1 = {
    orderId: "00000000-0000-4000-8000-000000000010", organizationId: scope.organizationId,
    accountId: scope.accountId, runId: scope.runId, symbol: "BTCUSDT", side: "buy",
    receiptDigest: digest, creationDigest: digest, state: "ACCEPTED", stateVersion: 4,
    quantity: "1", filledQuantity: "0", remainingQuantity: "1", acceptedAt: Date.parse("2026-01-01T00:01:00.000Z"),
    firstEligibleAt: Date.parse("2026-01-01T00:02:00.000Z"), eligibleBarsSeen: 0, fillSequence: 0,
    pendingCancel: null, stateEvent: { id: "event", sequence: 3, digest }, fillReferences: [],
  };
  const initialDelta = advanceHistoricalReconciliationV1(cycle());
  const previous = sealHistoricalReconciliationCycleV1({ delta: initialDelta, checkpointDigest: digest,
    activeParent: parent, touchedParents: [parent], observations: observations(initialDelta, parent) });
  const economics = applyHistoricalExecutionEconomics({ orderId: parent.orderId, organizationId: scope.organizationId,
    symbol: "BTCUSDT", side: "buy", fillSequence: 1, sourceBarIndex: 11,
    sourceBar: { symbol: "BTCUSDT", interval: "1m", open: "100", high: "100", low: "100", close: "100", volume: "10",
      barOpenTime: "2026-01-01T00:01:00.000Z", barCloseTime: "2026-01-01T00:02:00.000Z" },
    grossFillPrice: "100", sliceQuantity: "0.1", remainingQuantityAfter: "0.9", acceptedAt: new Date(parent.acceptedAt),
    fillTimestamp: new Date("2026-01-01T00:02:00.000Z"), submitLatencyMs: 50, cancelLatencyMs: null,
  }, createHistoricalExecutionModelV1());
  const fillId = "00000000-0000-4000-8000-000000000011";
  const fill = advanceAccountingFrontier({ state: mark(),
    fill: { fillId, economics, executedAt: "2026-01-01T00:02:00.000Z" },
    marks: { BTCUSDT: { price: "100", barCloseTime: "2026-01-01T00:02:00.000Z" } },
    frontierAsOf: "2026-01-01T00:02:00.000Z", frontierId: "00000000-0000-4000-8000-000000000012" });
  const final = advanceAccountingFrontier({ state: fill, marks: fill.marks, frontierAsOf: fill.frontierAsOf,
    frontierId: "00000000-0000-4000-8000-000000000013" });
  const f = { fillId, parentId: parent.orderId, organizationId: scope.organizationId,
    accountId: scope.accountId, runId: scope.runId, symbol: "BTCUSDT", side: "buy" as const, quantity: "0.1" };
  return { ...cycle(), previous, cycleId: "cycle-1", cycleSequence: 1, recordIndex: 11,
    steps: [projectHistoricalReconciliationAccountingV1(fill), projectHistoricalReconciliationAccountingV1(final)],
    fills: [f], economics: [{ ...f, economicsRowId: "distinct-economics-pk", economicsDigest: economics.economicsContentDigest,
      netCashEffect: economics.netCashEffect, sourceBarIndex: 11, fillSequence: 1 }],
    consumed: [{ fillId, accountingId: fill.id, accountingSequence: fill.accountingSequence,
      accountingDigest: fill.semanticContentDigest, economicsDigest: economics.economicsContentDigest }] };
}
describe("actual fill→mark independent expected cash and inventory", () => {
  it("accepts actual D-5 costed cash; economics PK is not the fill ID", () => {
    const input = fillCycle(); const value = advanceHistoricalReconciliationV1(input);
    expect(value.expectedCashAfter).toBe(input.steps[1]!.cash);
    expect(value.expectedOpenQuantityAfter).toBe("0.1");
    expect(value.consumedFillCount).toBe(1);
    expect(value.sourceEventCount).toBe(3);
    expect(value.fillDelta?.economicsRowId).toBe("distinct-economics-pk");
    expect(value.steps.map((p) => p.sourceFillId)).toEqual([input.fills[0]!.fillId, null]);
  });
  it.each(["cash", "inventory", "tail", "count", "fill-missing", "economics-missing", "accounting-missing", "wrong-fill", "wrong-parent", "wrong-account", "mark-first", "sequence"])("rejects %s drift", (kind) => {
    const input = fillCycle();
    if (kind === "cash") input.steps[1] = { ...input.steps[1]!, cash: "999999" };
    if (kind === "inventory") input.steps[1] = { ...input.steps[1]!, positions: { BTCUSDT: "0.2" } };
    if (kind === "tail") input.steps[1] = { ...input.steps[1]!, lastConsumedFillId: "other" };
    if (kind === "count") input.steps[1] = { ...input.steps[1]!, consumedFillCount: 2 };
    if (kind === "fill-missing") input.fills = [];
    if (kind === "economics-missing") input.economics = [];
    if (kind === "accounting-missing") input.consumed = [];
    if (kind === "wrong-fill") input.economics[0]!.fillId = "other";
    if (kind === "wrong-parent") input.economics[0]!.parentId = "other";
    if (kind === "wrong-account") input.economics[0]!.accountId = "other";
    if (kind === "mark-first") input.steps.reverse();
    if (kind === "sequence") input.steps[0] = { ...input.steps[0]!, sequence: 7 };
    expect(() => advanceHistoricalReconciliationV1(input)).toThrow("HISTORICAL_RECONCILIATION_REFUSED");
  });
  it("retains earlier immutable cycle identity after a later delta", () => {
    const input = fillCycle(); const before = JSON.stringify(input.previous);
    advanceHistoricalReconciliationV1(input);
    expect(JSON.stringify(input.previous)).toBe(before);
    expect(input.previous.accounting.consumedFillCount).toBe(0);
  });
  it("does not grant unchanged cash authority to a duplicate fill", () => {
    const input = fillCycle(); input.fills.push(input.fills[0]!); input.economics.push(input.economics[0]!);
    input.consumed.push(input.consumed[0]!);
    expect(() => advanceHistoricalReconciliationV1(input)).toThrow("FILL_MEMBERSHIP");
  });
});
describe("fixed held-reader admission (inert SQL only)", () => {
  it("rejects oversized metadata before body allocation/query", async () => {
    const unsafe = vi.fn().mockResolvedValueOnce([{ bytes: HISTORICAL_RECONCILIATION_PROJECTION_BYTES_V1 + 1 }]);
    const repo = createHistoricalReconciliationRepositoryV1(Object.assign(vi.fn(), { unsafe }) as never, scope);
    await expect(repo.readMode()).rejects.toThrow("RESOURCE_ENVELOPE");
    expect(unsafe).toHaveBeenCalledTimes(1);
    expect(unsafe.mock.calls[0]![0]).toContain("octet_length");
  });
  it("rejects metadata/body count changes and captures original scope before awaits", async () => {
    const mutable = { ...scope };
    const unsafe = vi.fn().mockImplementationOnce(async () => { mutable.accountId = "changed"; return [{ bytes: 20 }]; })
      .mockResolvedValueOnce([]);
    const repo = createHistoricalReconciliationRepositoryV1(Object.assign(vi.fn(), { unsafe }) as never, mutable);
    await expect(repo.readMode()).rejects.toThrow("SOURCE_SNAPSHOT");
    expect(unsafe.mock.calls[1]![1]).toEqual([scope.organizationId, scope.accountId, scope.runId]);
  });
  it("permits legitimate unprofiled absence but refuses invisible enrollment winner", async () => {
    const unsafe = vi.fn().mockResolvedValue([]);
    const tx = Object.assign(vi.fn().mockResolvedValue([]), { unsafe });
    const repo = createHistoricalReconciliationRepositoryV1(tx as never, scope);
    await expect(repo.readMode()).resolves.toBeNull();
    await expect(repo.enroll(genesis())).rejects.toThrow("MODE_WINNER_NOT_VISIBLE");
    expect(tx).toHaveBeenCalledTimes(1);
    expect(tx.mock.calls[0]![0].join("")).toContain("ON CONFLICT (organization_id,account_id,run_id) DO NOTHING");
  });
});
