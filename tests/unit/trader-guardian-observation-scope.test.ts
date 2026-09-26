import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHtrAccountingCycleBridge } from "@/lib/trader/accounting/htr-accounting-cycle-bridge";
import { DEFAULT_EXIT_RUN_CONFIG, EXIT_PLAN_SCHEMA_VERSION, type TrailingState } from "@/lib/trader/exits/exit-types";
import { evaluatePositionGuardian } from "@/lib/trader/guardian";
import * as evaluationCycle from "@/lib/trader/intelligence/evaluation-cycle";
import type { LifecycleRepository } from "@/lib/trader/lifecycle/lifecycle-repository.types";
import { runPaperCycleOnce } from "@/lib/trader/paper/paper-cycle-runner";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import { guardianScopeFixture } from "@/tests/helpers/guardian-observation-scope-fixture";

type Fixture = ReturnType<typeof guardianScopeFixture>;
const refusal = { code: "GUARDIAN_OBSERVATION_SCOPE_MISMATCH" };

function fixtureHarness(fixture = guardianScopeFixture()) {
  const lots = [fixture.lot];
  const trades = new Map([[fixture.trade.id, fixture.trade]]);
  const repository = {
    listOpenPositionLots: vi.fn<LifecycleRepository["listOpenPositionLots"]>(async (context, filter) => lots.filter((lot) =>
      lot.organizationId === context.organizationId && (!filter?.accountKey || lot.accountKey === filter.accountKey) && (!filter?.symbol || lot.symbol === filter.symbol))),
    getTradeById: vi.fn<LifecycleRepository["getTradeById"]>(async (_context, id) => trades.get(id) ?? null),
  } as unknown as LifecycleRepository;
  const recordGuardianEvaluated = vi.fn<NonNullable<PaperCycleDeps["lifecycleRecorder"]>["recordGuardianEvaluated"]>();
  const recordGuardianExitIntent = vi.fn<NonNullable<PaperCycleDeps["lifecycleRecorder"]>["recordGuardianExitIntent"]>();
  const submitOrder = vi.fn<PaperCycleDeps["execution"]["submitOrder"]>(async () => ({ status: "execution_v2_required", order: null, reason: "LEGACY_ORDER_SUBMISSION_DISABLED" }));
  const deps = {
    lifecycleRepository: repository,
    lifecycleRecorder: { recordGuardianEvaluated, recordGuardianExitIntent },
    execution: { submitOrder },
  } as unknown as PaperCycleDeps;
  vi.spyOn(evaluationCycle, "runEvaluationCycle").mockReturnValue(fixture.evaluation);
  return { fixture, lots, trades, repository, deps, recordGuardianEvaluated, recordGuardianExitIntent, submitOrder };
}

function pure(f: Fixture) {
  return {
    context: f.input.context, accountKey: f.input.accountKey, snapshot: f.input.snapshot, evaluation: f.evaluation,
    openLots: [f.lot], tradesById: new Map([[f.trade.id, f.trade]]), runConfig: { enabled: true }, markPrice: "65000",
  };
}

const mutations: [string, (f: Fixture) => void][] = [
  ["another lot organization", (f) => { f.lot.organizationId = "other-org"; }],
  ["another lot account", (f) => { f.lot.accountKey = "account-b"; }],
  ["another lot instrument", (f) => { f.lot.symbol = "ETH/USDT"; }],
  ["unproven symbol alias", (f) => { f.lot.symbol = "BTCUSDT"; }],
  ["closed lot", (f) => { f.lot.state = "CLOSED"; }],
  ["another trade organization", (f) => { f.trade.organizationId = "other-org"; }],
  ["another trade account", (f) => { f.trade.accountKey = "account-b"; }],
  ["another trade instrument", (f) => { f.trade.symbol = "ETH/USDT"; }],
  ["another trade venue", (f) => { f.trade.venue = "htx"; }],
  ["another trade side", (f) => { f.trade.positionSide = "SHORT"; }],
  ["another trade instrument kind", (f) => { f.trade.instrumentKind = "PERP"; }],
  ["another opening signal", (f) => { f.trade.strategySignalId = "other-signal"; }],
  ["missing bound trade", (f) => { f.lot.tradeId = "missing-trade"; }],
  ["another feature instrument", (f) => { f.evaluation.features.instrumentId = "ETH/USDT"; }],
  ["another MSV instrument", (f) => { f.evaluation.msv.instrumentId = "ETH/USDT"; }],
  ["another quote instrument", (f) => { f.input.snapshot.quote.symbol = "ETH/USDT"; }],
  ["another later bar instrument", (f) => { f.input.snapshot.bars[15]!.symbol = "ETH/USDT"; }],
  ["empty account", (f) => { f.input.accountKey = ""; }],
];

describe("Guardian exact observation scope (DEE-1119)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it.each(mutations)("pure evaluator refuses %s before producing observations", (_name, mutate) => {
    const fixture = guardianScopeFixture(); mutate(fixture);
    expect(() => evaluatePositionGuardian(pure(fixture))).toThrowError(expect.objectContaining(refusal));
  });

  it.each(mutations)("actual cycle refuses unexpectedly returned %s before recording or submission", async (_name, mutate) => {
    const harness = fixtureHarness(); mutate(harness.fixture);
    vi.mocked(harness.repository.listOpenPositionLots).mockResolvedValue(harness.lots);
    await expect(runPaperCycleOnce(harness.deps, harness.fixture.input)).rejects.toMatchObject(refusal);
    expect(harness.recordGuardianEvaluated).not.toHaveBeenCalled();
    expect(harness.recordGuardianExitIntent).not.toHaveBeenCalled();
    expect(harness.submitOrder).not.toHaveBeenCalled();
  });

  it("queries only the exact account/instrument and preserves the eligible lot in a mixed dataset", async () => {
    const h = fixtureHarness();
    for (const [symbol, accountKey] of [["ETH/USDT", "account-a"], ["BTC/USDT", "account-b"], ["ETH/USDT", "account-b"]]) {
      const id = symbol + accountKey;
      h.lots.push({ ...h.fixture.lot, id: "lot-" + id, tradeId: id, symbol, accountKey });
      h.trades.set(id, { ...h.fixture.trade, id, symbol, accountKey });
    }
    const result = await runPaperCycleOnce(h.deps, h.fixture.input);
    expect(h.repository.listOpenPositionLots).toHaveBeenCalledWith(h.fixture.input.context, { symbol: "BTC/USDT", accountKey: "account-a" });
    expect(result.guardian?.evaluations.map((row) => row.positionLotId)).toEqual([h.fixture.lot.id]);
    expect(result.guardian?.evaluations[0]?.reason.unrealizedPnlUsdt).toBe("1000");
    expect(result.guardian?.exitIntents).toMatchObject([{ symbol: "BTC/USDT", accountKey: "account-a", quantity: "1" }]);
    expect(h.recordGuardianEvaluated).toHaveBeenCalledTimes(1);
    expect(h.recordGuardianExitIntent).toHaveBeenCalledTimes(1);
    expect(h.submitOrder).toHaveBeenCalledTimes(1);
    expect(result.guardianExecutions?.[0]?.execution?.status).toBe("execution_v2_required");
  });

  it("HOLD still records the correctly scoped valuation without an exit", async () => {
    const h = fixtureHarness(); h.fixture.evaluation.msv.derived.tradingPermission = "ALLOW_TRADING";
    const result = await runPaperCycleOnce(h.deps, h.fixture.input);
    expect(result.guardian?.evaluations).toMatchObject([{ decision: "HOLD", reason: { unrealizedPnlUsdt: "1000" } }]);
    expect(h.recordGuardianEvaluated).toHaveBeenCalledTimes(1);
    expect(h.submitOrder).not.toHaveBeenCalled();
  });

  it("empty and disabled controls perform no observation or submission", async () => {
    const h = fixtureHarness(); h.lots.length = 0;
    expect((await runPaperCycleOnce(h.deps, h.fixture.input)).guardian).toEqual({ evaluations: [], exitIntents: [] });
    vi.mocked(h.repository.listOpenPositionLots).mockClear();
    h.fixture.input.guardian!.runConfig.enabled = false;
    h.fixture.input.snapshot.quote.symbol = "ETH/USDT";
    expect((await runPaperCycleOnce(h.deps, h.fixture.input)).guardian).toBeUndefined();
    expect(h.repository.listOpenPositionLots).not.toHaveBeenCalled();
    expect(h.recordGuardianEvaluated).not.toHaveBeenCalled();
    expect(h.submitOrder).not.toHaveBeenCalled();
  });

  it("keeps the HTR early return before legacy observation reads or binding", async () => {
    const h = fixtureHarness();
    h.fixture.input.snapshot.cycleId = "25";
    h.fixture.input.snapshot.quote.symbol = "ETH/USDT";
    h.fixture.input.htrAccounting = {
      bridge: createHtrAccountingCycleBridge({ organizationId: h.fixture.input.context.organizationId, accountKey: "account-a", runId: "scope-htr", frontierAsOf: h.fixture.input.snapshot.evaluatedAt }),
      resolveInventoryOpenQtyBySymbol: vi.fn(async () => ({})),
    };
    const result = await runPaperCycleOnce(h.deps, h.fixture.input);
    expect(result.guardian).toBeUndefined();
    expect(result.htrGuardian).toBeDefined();
    expect(h.repository.listOpenPositionLots).not.toHaveBeenCalled();
    expect(h.recordGuardianEvaluated).not.toHaveBeenCalled();
    expect(h.submitOrder).not.toHaveBeenCalled();
  });

  it("keeps the captured organization/account scope across asynchronous reads", async () => {
    const h = fixtureHarness(); const organizationId = h.fixture.lot.organizationId;
    vi.mocked(h.repository.listOpenPositionLots).mockImplementationOnce(async () => {
      h.fixture.input.context.organizationId = "other-org";
      h.fixture.input.accountKey = "account-b";
      return h.lots;
    });
    await runPaperCycleOnce(h.deps, h.fixture.input);
    expect(h.recordGuardianEvaluated.mock.calls[0]?.[0].context.organizationId).toBe(organizationId);
    expect(h.submitOrder.mock.calls[0]).toMatchObject([{ organizationId }, { accountKey: "account-a" }]);
  });

  it("refuses a trade map entry whose value has a different identifier", () => {
    const f = guardianScopeFixture(), input = pure(f);
    input.tradesById.set(f.lot.tradeId, { ...f.trade, id: "other-trade" });
    expect(() => evaluatePositionGuardian(input)).toThrowError(expect.objectContaining(refusal));
  });

  it("refuses separate exit-engine bars for another instrument without changing state", () => {
    const f = guardianScopeFixture(), trailingStateByLotId = new Map<string, TrailingState>();
    expect(() => evaluatePositionGuardian({ ...pure(f), exitEngine: { runConfig: DEFAULT_EXIT_RUN_CONFIG, bars: [{ ...f.input.snapshot.bars[0]!, symbol: "ETH/USDT" }], trailingStateByLotId } })).toThrowError(expect.objectContaining(refusal));
    expect(trailingStateByLotId.size).toBe(0);
  });

  it.each(["ETH/USDT", "BTCUSDT"])("accepts an internally consistent exact %s observation without normalizing", async (symbol) => {
    const h = fixtureHarness();
    h.fixture.lot.symbol = symbol; h.fixture.trade.symbol = symbol;
    h.fixture.lot.avgCost = "2000";
    h.fixture.input.snapshot.quote.symbol = symbol;
    h.fixture.input.snapshot.quote.last = "2100";
    h.fixture.input.snapshot.bars.forEach((bar) => { bar.symbol = symbol; bar.close = "2100"; });
    h.fixture.evaluation.features.instrumentId = symbol;
    h.fixture.evaluation.features.features.close = "2100";
    h.fixture.evaluation.msv.instrumentId = symbol;
    h.fixture.evaluation.msv.physics.close = "2100";
    const result = await runPaperCycleOnce(h.deps, h.fixture.input);
    expect(result.guardian?.evaluations[0]?.reason.unrealizedPnlUsdt).toBe("100");
    expect(result.guardian?.exitIntents[0]?.symbol).toBe(symbol);
  });

  it("validates a later mismatched row before touching any trailing state", () => {
    const f = guardianScopeFixture();
    const foreign = { ...f.lot, id: "z-foreign", accountKey: "account-b" };
    const trailingStateByLotId = new Map<string, TrailingState>();
    const input = { ...pure(f), openLots: [f.lot, foreign], exitEngine: { runConfig: DEFAULT_EXIT_RUN_CONFIG, bars: f.input.snapshot.bars, trailingStateByLotId } };
    expect(() => evaluatePositionGuardian(input)).toThrowError(expect.objectContaining(refusal));
    expect(trailingStateByLotId.size).toBe(0);
  });

  it("preserves other scopes' trailing state when evaluating an exact subset", () => {
    const f = guardianScopeFixture();
    const foreign: TrailingState = { schemaVersion: EXIT_PLAN_SCHEMA_VERSION, phase: "ARMED", entryPrice: "2000", activationPrice: "2050", trailingDistanceUsdt: "10", maxFavorableExcursionUsdt: "100", peakPrice: "2100", stopPrice: "2090", lastUpdatedAt: "2026-01-01T00:24:00.000Z" };
    const trailingStateByLotId = new Map([["other-account-or-instrument", foreign]]);
    const input = { ...pure(f), exitEngine: { runConfig: DEFAULT_EXIT_RUN_CONFIG, bars: f.input.snapshot.bars, trailingStateByLotId } };
    evaluatePositionGuardian(input);
    const previousSelected = trailingStateByLotId.get(f.lot.id);
    evaluatePositionGuardian(input);
    expect(trailingStateByLotId.get("other-account-or-instrument")).toBe(foreign);
    expect(JSON.stringify(trailingStateByLotId.get("other-account-or-instrument"))).toBe(JSON.stringify(foreign));
    expect(trailingStateByLotId.has(f.lot.id)).toBe(true);
    expect(trailingStateByLotId.get(f.lot.id)).not.toBe(previousSelected);
  });
});
