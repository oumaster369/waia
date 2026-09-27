import { describe, expect, it } from "vitest";
import { createInitialAccountingState, advanceAccountingFrontier, computeAccountingSemanticDigest } from
  "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import {
  createHistoricalReconciliationGenesisV1, advanceHistoricalReconciliationV1,
  observeHistoricalReconciliationV1, sealHistoricalReconciliationCycleV1,
  assertHistoricalReconciliationFrontierV1, projectHistoricalReconciliationAccountingV1,
  createHistoricalReconciliationBudgetV1, HISTORICAL_RECONCILIATION_PROJECTION_BYTES_V1,
  captureHistoricalReconciliationProducedFillsV1, assertHistoricalReconciliationProducedFillsV1,
  historicalReconciliationInstantV1, projectHistoricalReconciliationSourceValueV1,
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
        state: mark(), accounting: projectHistoricalReconciliationAccountingV1(mark()), activeParent: null,
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
      state: mark(), accounting: projectHistoricalReconciliationAccountingV1(mark()), activeParent: null,
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
import { historicalFillId } from "@/lib/trader/execution/deterministic-execution-id";
import { canonicalizeSemanticJsonString, computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { selectValidatedHistoricalReconciliationStateV1 } from "@/lib/trader/historical-simulation-v2/production-runtime-state-v2";

function observations(delta: HistoricalReconciliationDeltaV1, parent: HistoricalReconciliationParentV1 | null, state = mark()) {
  const result: ReturnType<typeof observeHistoricalReconciliationV1>[] = [];
  for (const phase of ["frontier_mutation", "before_guardian", "before_cycle_complete"] as const) {
    result.push(observeHistoricalReconciliationV1({ delta, phase, state, accounting: delta.accounting,
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
  const event = { orderId: parent.orderId, organizationId: scope.organizationId,
    symbol: "BTCUSDT", side: "buy" as const, fillSequence: 1, sourceBarIndex: 11,
    sourceBar: { symbol: "BTCUSDT", interval: "1m" as const, open: "100", high: "100", low: "100", close: "100", volume: "10",
      barOpenTime: "2026-01-01T00:01:00.000Z", barCloseTime: "2026-01-01T00:02:00.000Z" },
    grossFillPrice: "100", sliceQuantity: "0.1", remainingQuantityAfter: "0.9", acceptedAt: new Date(parent.acceptedAt),
    fillTimestamp: new Date("2026-01-01T00:02:00.000Z"), submitLatencyMs: 50, cancelLatencyMs: null,
  };
  const economics = applyHistoricalExecutionEconomics(event, createHistoricalExecutionModelV1());
  const fillId = historicalFillId({ organizationId: scope.organizationId, orderId: parent.orderId, fillSequence: 1, sourceBarIndex: 11 });
  const fill = advanceAccountingFrontier({ state: mark(),
    fill: { fillId, economics, executedAt: "2026-01-01T00:02:00.000Z" },
    marks: { BTCUSDT: { price: "100", barCloseTime: "2026-01-01T00:02:00.000Z" } },
    frontierAsOf: "2026-01-01T00:02:00.000Z", frontierId: "00000000-0000-4000-8000-000000000012" });
  const final = advanceAccountingFrontier({ state: fill, marks: fill.marks, frontierAsOf: fill.frontierAsOf,
    frontierId: "00000000-0000-4000-8000-000000000013" });
  const evidence = { schemaVersion: "waia.trader.historical_modeled_fill_evidence.v2" as const,
    source: "MODELED_HISTORICAL" as const, capitalEligible: false as const, cycleId: "cycle-1",
    sealedMarketCycleContentDigestHex: digest, orderId: parent.orderId, fillId,
    economicsContentDigestHex: economics.economicsContentDigest,
    accountingFrontierContentDigestHex: fill.semanticContentDigest, contentDigestHex: digest };
  const body = { schemaVersion: "waia.trader.historical_modeled_fill_detail.v2" as const, evidence,
    event: { ...event, acceptedAt: event.acceptedAt.toISOString(), fillTimestamp: event.fillTimestamp.toISOString() },
    economics: { ...economics, acceptedAt: economics.acceptedAt.toISOString(),
      fillTimestamp: economics.fillTimestamp.toISOString(), sourceBarTimestamp: economics.sourceBarTimestamp.toISOString() },
    accountingFrontier: fill };
  const detail = { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
  const produced = captureHistoricalReconciliationProducedFillsV1(scope, [detail])[0]!;
  return { ...cycle(), detail, final, previous, cycleId: "cycle-1", cycleSequence: 1, recordIndex: 11,
    steps: [projectHistoricalReconciliationAccountingV1(fill), projectHistoricalReconciliationAccountingV1(final)],
    fills: [{ ...produced.fill }], economics: [{ ...produced.economics, sourceEconomics: { ...produced.economics.sourceEconomics } }],
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
    expect(value.fillDelta?.economicsRowId).toBe(input.economics[0]!.economicsRowId);
    expect(value.fillDelta?.economicsRowId).not.toBe(input.fills[0]!.fillId);
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

// The prior implementation accepted resealed inconsistent equity/PnL at every phase.
describe("existing Accounting invariant gate at each real phase", () => {
  for (const phase of ["frontier_mutation", "before_guardian", "before_cycle_complete"] as const) {
    it.each(["equity", "netRealizedPnl"] as const)(`${phase} refuses independently resealed %s`, (field) => {
      const state = mark();
      state[field] = field === "equity" ? "999" : "1";
      state.semanticContentDigest = computeAccountingSemanticDigest(state);
      const accounting = projectHistoricalReconciliationAccountingV1(state);
      const delta = advanceHistoricalReconciliationV1({ ...cycle(), steps: [accounting] });
      const valid = observations(advanceHistoricalReconciliationV1(cycle()), null);
      const index = ["frontier_mutation", "before_guardian", "before_cycle_complete"].indexOf(phase);
      expect(() => observeHistoricalReconciliationV1({ delta, phase, state, accounting,
        activeParent: null, touchedParents: [], previousObservations: valid.slice(0, index) }))
        .toThrow("ACCOUNTING_INVARIANT");
    });
  }
  it("accepts real costed fill/mark through the existing invariant helper in all phases", () => {
    const input = fillCycle(); const delta = advanceHistoricalReconciliationV1(input);
    expect(observations(delta, null, input.final)).toHaveLength(3);
  });
  it("supplies explicit empty current IDs, never the canonical cumulative fallback", () => {
    const state = mark();
    state.consumedFillIds = new Proxy([], { get(target, key, receiver) {
      if (key === Symbol.iterator) throw new Error("cumulative fallback");
      return Reflect.get(target, key, receiver);
    } });
    expect(observations(advanceHistoricalReconciliationV1(cycle()), null, state)).toHaveLength(3);
  });
});

describe("actual produced detail to complete persisted source projection", () => {
  it("joins physical fill and full economics without changing their existing digests", () => {
    const value = fillCycle();
    const captured = captureHistoricalReconciliationProducedFillsV1(scope, [value.detail]);
    expect(() => assertHistoricalReconciliationProducedFillsV1(captured, value.fills, value.economics, value.steps)).not.toThrow();
    expect(captured[0]!.economics.economicsDigest).toBe(value.detail.economics.economicsContentDigest);
  });
  it.each(["price", "fee", "feeAsset", "exchangeTradeId", "executedAt"] as const)("refuses one changed physical fill %s", (field) => {
    const value = fillCycle(); const captured = captureHistoricalReconciliationProducedFillsV1(scope, [value.detail]);
    const altered = { ...value.fills[0]!, [field]: field === "executedAt" ? value.fills[0]!.executedAt + 1 : "altered" };
    expect(() => assertHistoricalReconciliationProducedFillsV1(captured, [altered], value.economics, value.steps))
      .toThrow("PRODUCED_SOURCE_CONTENT");
  });
  it.each(["acceptedAt", "fillTimestamp", "sourceBarTimestamp"] as const)("refuses changed %s under the unchanged economics digest", (field) => {
    const value = fillCycle(); const captured = captureHistoricalReconciliationProducedFillsV1(scope, [value.detail]);
    value.economics[0]!.sourceEconomics[field] += 1;
    expect(value.economics[0]!.economicsDigest).toBe(captured[0]!.economics.economicsDigest);
    expect(() => assertHistoricalReconciliationProducedFillsV1(captured, value.fills, value.economics, value.steps))
      .toThrow("PRODUCED_SOURCE_CONTENT");
  });
  it.each(["economicsRowId", "exchangeTradeId", "schemaVersion"] as const)("refuses changed economics %s", (field) => {
    const value = fillCycle(); const captured = captureHistoricalReconciliationProducedFillsV1(scope, [value.detail]);
    value.economics[0]![field] = "altered";
    expect(() => assertHistoricalReconciliationProducedFillsV1(captured, value.fills, value.economics, value.steps))
      .toThrow("PRODUCED_SOURCE_CONTENT");
  });
  it("compares equivalent timezone spellings as the same supported instant", () => {
    const value = fillCycle(); const captured = captureHistoricalReconciliationProducedFillsV1(scope, [value.detail]);
    const alternate = { ...value.detail, event: { ...value.detail.event, acceptedAt: "2026-01-01T03:01:00+03:00" },
      economics: { ...value.detail.economics, acceptedAt: "2026-01-01T00:01:00Z" } };
    expect(captureHistoricalReconciliationProducedFillsV1(scope, [alternate])).toEqual(captured);
    expect(() => historicalReconciliationInstantV1(captured[0]!.fill.executedAt + 0.5)).toThrow("SOURCE_TIME");
  });
  it("captures no cumulative Accounting array from a produced detail", () => {
    const value = fillCycle();
    value.detail.accountingFrontier.consumedFillIds = new Proxy([value.fills[0]!.fillId], {
      get(target, key, receiver) { if (key === Symbol.iterator || key === "map" || key === "toJSON") throw new Error("history scan");
        return Reflect.get(target, key, receiver); },
    });
    expect(captureHistoricalReconciliationProducedFillsV1(scope, [value.detail])).toHaveLength(1);
  });
});

describe("selected validated N runtime projection", () => {
  it.each([1, 1000000])("does not reread unrelated cumulative state for prefix length %s", (length) => {
    const state = mark(); const ids = { length, [length - 1]: "last" };
    state.consumedFillIds = new Proxy(ids, { get(target, key, receiver) {
      if (key !== "length" && key !== String(length - 1)) throw new Error("cumulative read");
      return Reflect.get(target, key, receiver);
    } }) as unknown as string[];
    const selected = { accountingFrontierSnapshot: { state },
      modeledExchangeSnapshot: { state: { openOrders: [], checkpoint: { openOrders: [] } } },
      get modeledExecutionRegistrySnapshot() { throw new Error("registry restore"); },
      get knowledgeSnapshot() { throw new Error("Knowledge restore"); },
      get learningSnapshot() { throw new Error("learning restore"); },
    };
    const result = selectValidatedHistoricalReconciliationStateV1(selected as never);
    expect(result.accounting).toBe(state);
    expect(projectHistoricalReconciliationAccountingV1(result.accounting).consumedFillCount).toBe(length);
    expect(result.open).toEqual([]);
  });
});

describe("fresh held parent read includes immutable creation bindings", () => {
  const receipt = { orderId: "00000000-0000-4000-8000-000000000010", symbol: "BTCUSDT", side: "buy",
    quantity: "1", executionAttemptId: "attempt", contentDigestHex: digest,
    riskVerdictId: "risk-verdict", decisionId: "decision" };
  const source = () => ({ orderId: receipt.orderId, organizationId: scope.organizationId,
    accountId: scope.accountId, runId: scope.runId, symbol: receipt.symbol, side: receipt.side,
    quantity: "1", filledQuantity: "0", state: "ACCEPTED", stateVersion: 4,
    venue: "HISTORICAL_SIMULATED_EXCHANGE", executionMode: "mock", credentialId: null,
    type: "market", price: null, riskAllowanceId: null, riskAllowanceBindingDigest: null,
    clientOrderId: "hsv2-attempt", idempotencyKey: `historical-modeled-v2-${digest}`,
    riskDecisionId: "risk-verdict", allocationDecisionId: "decision" });
  async function observe(row: Record<string, unknown>) {
    const event = { id: "event", orderId: receipt.orderId, sequence: 3, fromState: "SENT_TO_EXCHANGE",
      toState: "ACCEPTED", eventType: "STATE_TRANSITION", payload: null, occurredAt: "2026-01-01T00:00:00.000Z" };
    const unsafe = vi.fn(async (sql: string) => {
      const values = sql.includes("FROM trader_orders o") ? [row] : sql.includes("FROM trader_order_events e") ? [event] : [];
      return sql.includes("octet_length") ? values.map((value) => ({ bytes: Buffer.byteLength(JSON.stringify(value)) })) :
        values.map((projection) => ({ projection }));
    });
    const repo = createHistoricalReconciliationRepositoryV1(Object.assign(vi.fn(), { unsafe }) as never, scope);
    const entry = { order: { id: receipt.orderId, state: "ACCEPTED", stateVersion: 4, filledQuantity: "0" },
      remainingQty: "1", filledQty: "0", acceptedAtTs: 1, firstEligibleTs: 2,
      sameSymbolEligibleBarsSeen: 0, fillSequence: 0 };
    const runtime = { exchange: { listOpenOrders: () => [entry] }, executionRegistry: { get: () => receipt } };
    return repo.observeParents(runtime as never, null, [entry] as never);
  }
  it("accepts the actual historical creation projection through the held read", async () => {
    await expect(observe(source())).resolves.toMatchObject({ activeParent: { orderId: receipt.orderId } });
  });
  it.each(["type", "price", "riskAllowanceId", "riskAllowanceBindingDigest", "clientOrderId", "idempotencyKey",
    "riskDecisionId", "allocationDecisionId", "credentialId"])("refuses changed immutable creation %s", async (field) => {
    await expect(observe({ ...source(), [field]: "changed" })).rejects.toThrow("PARENT_SOURCE_IDENTITY");
  });
});


describe("independently checkable source projections", () => {
  it("reads only count/tail from a long canonical Accounting history", () => {
    const state = inception();
    state.consumedFillIds = new Proxy(Array.from({ length: 10000 }, (_, n) => `fill-${n}`), {
      get(target, key, receiver) {
        if (key !== "length" && key !== "9999") throw new Error("new history access");
        return Reflect.get(target, key, receiver);
      },
    });
    const value = projectHistoricalReconciliationSourceValueV1("ACCOUNTING_FRONTIER", state);
    expect(value).toMatchObject({ accounting: { consumedFillCount: 10000, lastConsumedFillId: "fill-9999" }, positionBasis: {} });
    expect(JSON.stringify(value)).not.toContain('"consumedFillIds"');
  });
  it("retains exact current position basis without changing frontier arithmetic", () => {
    const state = fillCycle().final;
    expect(projectHistoricalReconciliationSourceValueV1("ACCOUNTING_FRONTIER", state)).toEqual({
      accounting: projectHistoricalReconciliationAccountingV1(state), positionBasis: state.positions,
    });
  });
  it.each(["BTCUSDT", "ETHUSDT"])("refuses an additional position beside %s", (symbol) => {
    const state = inception(); state.positions[symbol] = { quantity: "1", grossPositionBasis: "1", netPositionBasis: "1" };
    state.positions.OTHER = { quantity: "0", grossPositionBasis: "0", netPositionBasis: "0" };
    expect(() => projectHistoricalReconciliationSourceValueV1("ACCOUNTING_FRONTIER", state)).toThrow("SOURCE_PROJECTION");
  });
  it("captures actual fill details without copying nested Accounting history", () => {
    const { detail } = fillCycle();
    detail.accountingFrontier.consumedFillIds = new Proxy(detail.accountingFrontier.consumedFillIds, {
      get() { throw new Error("detail history read"); },
    });
    const artifact = { artifactKind: "MODELED_EXECUTION_EFFECT", artifactId: "effect", contentDigestHex: digest,
      payload: { lineagePayload: { fillDetail: detail } } };
    const value = projectHistoricalReconciliationSourceValueV1("OBSERVED_EXECUTION_EFFECTS", [artifact]);
    expect(value).toMatchObject({ artifactCount: 1, artifacts: [{ detail: {
      accountingId: detail.accountingFrontier.id, accountingDigest: detail.accountingFrontier.semanticContentDigest,
      event: { acceptedAt: detail.event.acceptedAt, fillTimestamp: detail.event.fillTimestamp },
      economics: { sourceBarTimestamp: detail.economics.sourceBarTimestamp },
    } }] });
    expect(JSON.stringify(value)).not.toContain('"consumedFillIds"');
  });
  it("retains both artifact slots and refuses a third or second fill detail", () => {
    const a = { artifactKind: "MODELED_EXECUTION_EFFECT", artifactId: "effect", contentDigestHex: digest };
    expect(projectHistoricalReconciliationSourceValueV1("OBSERVED_EXECUTION_EFFECTS", [a, a])).toMatchObject({ artifactCount: 2 });
    expect(() => projectHistoricalReconciliationSourceValueV1("OBSERVED_EXECUTION_EFFECTS", [a, a, a])).toThrow("SOURCE_PROJECTION");
    const withDetail = { ...a, payload: { lineagePayload: { fillDetail: fillCycle().detail } } };
    expect(() => projectHistoricalReconciliationSourceValueV1("OBSERVED_EXECUTION_EFFECTS", [withDetail, withDetail])).toThrow("SOURCE_PROJECTION");
  });
  it("keeps a no-fill effect and exact single Accounting artifact", () => {
    const a = { artifactKind: "ACCOUNTING_FRONTIER", artifactId: "mark", contentDigestHex: digest };
    expect(projectHistoricalReconciliationSourceValueV1("ACCOUNTING", [a])).toEqual({ artifactCount: 1, artifact: a });
    expect(() => projectHistoricalReconciliationSourceValueV1("ACCOUNTING", [{ ...a, extra: true }])).toThrow("SOURCE_PROJECTION");
    expect(() => projectHistoricalReconciliationSourceValueV1("ACCOUNTING", [a, a])).toThrow("SOURCE_PROJECTION");
  });
  it("projects flat exchange and refuses unexpected open-order cardinality", () => {
    expect(projectHistoricalReconciliationSourceValueV1("MODELED_EXCHANGE", { openOrders: [], checkpoint: { openOrders: [] } }))
      .toEqual({ orders: 0, entries: 0, parent: null });
    expect(() => projectHistoricalReconciliationSourceValueV1("MODELED_EXCHANGE", { openOrders: [], checkpoint: { openOrders: [{}] } }))
      .toThrow("SOURCE_PROJECTION");
  });
  it("leaves unrelated source kinds unprojected without touching their bodies", () => {
    const body = new Proxy({}, { get() { throw new Error("unrelated source accessed"); } });
    expect(projectHistoricalReconciliationSourceValueV1("KNOWLEDGE", body)).toBeNull();
  });
});

describe("exact companion text and one candidate preparation budget", () => {
  const stored = (bodyText: string) => {
    const value = genesis();
    return { bodyText, id: value.id, contentDigest: value.contentDigest, profile: value.profile,
      partition: value.scope.split, symbol: value.symbol, previousId: value.previousId,
      genesisId: value.genesisId, checkpointDigest: value.checkpointDigest };
  };
  it("loads canonical text through preflight and returns the unchanged complete identity", async () => {
    const value = genesis(); const row = stored(canonicalizeSemanticJsonString(value));
    const unsafe = vi.fn().mockResolvedValueOnce([{ bytes: Buffer.byteLength(JSON.stringify(row)) }])
      .mockResolvedValueOnce([{ projection: row }]);
    const repo = createHistoricalReconciliationRepositoryV1({ unsafe } as never, scope);
    expect(await repo.loadFrontier(-1)).toEqual(value);
    expect(unsafe.mock.calls[0]![0]).toContain("body_text");
    expect(unsafe.mock.calls[0]![0]).not.toContain("body_json");
  });
  it.each(["trailing whitespace", "different key order"])("refuses %s despite equal parsed content", async kind => {
    const value = genesis();
    const text = kind === "trailing whitespace" ? canonicalizeSemanticJsonString(value) + " " : JSON.stringify(value);
    expect(JSON.parse(text)).toEqual(value);
    expect(text).not.toBe(canonicalizeSemanticJsonString(value));
    const row = stored(text);
    const unsafe = vi.fn().mockResolvedValueOnce([{ bytes: Buffer.byteLength(JSON.stringify(row)) }])
      .mockResolvedValueOnce([{ projection: row }]);
    await expect(createHistoricalReconciliationRepositoryV1({ unsafe } as never, scope).loadFrontier(-1))
      .rejects.toThrow("FRONTIER_TEXT");
  });
  it("writes only exact canonical text, leaving independent derived JSON to the native stamp", async () => {
    const value = genesis(); const tx = vi.fn().mockResolvedValue([]);
    await createHistoricalReconciliationRepositoryV1(tx as never, scope).append(value);
    const args = tx.mock.calls[0]!;
    expect((args[0] as unknown as string[]).join("?")).toContain("body_text");
    expect((args[0] as unknown as string[]).join("?")).not.toContain("body_json");
    expect(args.at(-1)).toBe(canonicalizeSemanticJsonString(value));
  });
  it("charges repeated selected bodies in the same owner attempt and keeps failure sticky", () => {
    const repo = createHistoricalReconciliationRepositoryV1({} as never, scope);
    const artifacts = [{ artifactKind: "ACCOUNTING_FRONTIER", artifactId: "x".repeat(500_000), contentDigestHex: digest }];
    for (let i = 0; i < 3; i++) expect(repo.prepareSourceValue("ACCOUNTING", artifacts)).not.toBeNull();
    expect(() => repo.prepareSourceValue("ACCOUNTING", artifacts)).toThrow("RESOURCE_ENVELOPE");
    expect(() => repo.prepareSourceValue("ACCOUNTING", [{ ...artifacts[0], artifactId: "small" }])).toThrow("RESOURCE_ENVELOPE");
  });
});
