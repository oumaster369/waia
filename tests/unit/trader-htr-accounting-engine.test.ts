import { describe, expect, it } from "vitest";

import {
  AccountingIdempotencyConflictError,
  AccountingInvariantError,
  advanceAccountingFrontier,
  assertAccountingIdempotency,
  buildHtrPnlReportV1,
  computeAccountingSemanticDigest,
  computeHtrPnlReportDigest,
  createAccountingFrontierRepositoryMemory,
  createInitialAccountingState,
  grossUnrealizedPnl,
  netUnrealizedPnl,
  type AccountingFillInput,
  type AccountingFrontierV1,
  type AccountingStateV1,
} from "@/lib/trader/accounting";
import {
  accountingFrontierToRow,
  accountingRowToFrontier,
} from "@/lib/trader/accounting/accounting-frontier-serialization";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";
import {
  computePeakEquityDrawdownBps,
  resolveMonthKeyUtc,
} from "@/lib/trader/risk/drawdown-policy-evaluator";
import {
  addDecimal,
  compareDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";
import {
  BTC_MARK,
  ETH_MARK,
  makeAccountingEconomicsFill,
} from "@/tests/unit/helpers/htr-accounting-fixtures";

const ORG_ID = "00000000-0000-4000-8000-000000041801";
const BTC_MARKS = { BTCUSDT: BTC_MARK };
const ETH_MARKS = { ETHUSDT: ETH_MARK };
const ACCOUNT_KEY = "htr-shared-portfolio";
const RUN_ID = "htr-accounting-run-1";

function baseState(overrides?: Partial<Parameters<typeof createInitialAccountingState>[0]>) {
  return createInitialAccountingState({
    organizationId: ORG_ID,
    accountKey: ACCOUNT_KEY,
    runId: RUN_ID,
    ...overrides,
  });
}

function frontierToState(frontier: AccountingFrontierV1): AccountingStateV1 {
  const {
    id: _id,
    sourceFillId: _sourceFillId,
    sourceEconomicsDigest: _sourceEconomicsDigest,
    semanticContentDigest: _semanticContentDigest,
    idempotencyKey: _idempotencyKey,
    ...state
  } = frontier;
  return state;
}

function advanceFill(
  state: AccountingStateV1,
  fill: AccountingFillInput,
  options?: {
    marks?: Record<string, { price: string; barCloseTime: string }>;
    frontierAsOf?: string;
  },
): AccountingFrontierV1 {
  return advanceAccountingFrontier({
    state,
    fill,
    marks: options?.marks,
    frontierAsOf: options?.frontierAsOf ?? fill.executedAt,
  });
}

function advanceMark(
  state: AccountingStateV1,
  marks: Record<string, { price: string; barCloseTime: string }>,
  frontierAsOf: string,
): AccountingFrontierV1 {
  return advanceAccountingFrontier({
    state,
    marks,
    frontierAsOf,
  });
}

describe("HTR-WP18 canonical cross-backend accounting engine", () => {
  it("initial state 100000 USDT zero BTC ETH", () => {
    const state = baseState();
    expect(state.cash).toBe(HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT);
    expect(state.equity).toBe(HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT);
    expect(Object.keys(state.positions)).toHaveLength(0);
    expect(state.grossRealizedPnl).toBe("0");
    expect(state.netRealizedPnl).toBe("0");
    expect(state.accountingSequence).toBe(1);
  });

  it("shared portfolio single cash", () => {
    const buyBtc = makeAccountingEconomicsFill("buy");
    const afterBtc = advanceFill(baseState(), buyBtc);
    const buyEth = makeAccountingEconomicsFill("buy", {
      symbol: "ETHUSDT",
      grossFillPrice: "3000",
      sliceQuantity: "1.00000000",
    });
    const afterEth = advanceFill(frontierToState(afterBtc), buyEth);

    expect(
      compareDecimal(afterEth.cash, addDecimal(afterBtc.cash, buyEth.economics.netCashEffect)),
    ).toBe(0);
    expect(compareDecimal(afterEth.cash, "0")).toBe(1);
    expect(compareDecimal(afterEth.positions.BTCUSDT?.quantity ?? "0", "0.1")).toBe(0);
    expect(compareDecimal(afterEth.positions.ETHUSDT?.quantity ?? "0", "1")).toBe(0);
  });

  it("buy full fill dual basis cash", () => {
    const fill = makeAccountingEconomicsFill("buy");
    const frontier = advanceFill(baseState(), fill);
    const pos = frontier.positions.BTCUSDT!;

    expect(compareDecimal(pos.quantity, "0.1")).toBe(0);
    expect(compareDecimal(pos.grossPositionBasis, "1000")).toBe(0);
    expect(compareDecimal(pos.netPositionBasis, "1003.5")).toBe(0);
    expect(
      compareDecimal(
        frontier.cash,
        subtractDecimal(HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT, "1003.5"),
      ),
    ).toBe(0);
  });

  it("buy partial fill", () => {
    const partial = makeAccountingEconomicsFill("buy", { sliceQuantity: "0.05000000" });
    const first = advanceFill(baseState(), partial);
    const second = advanceFill(frontierToState(first), {
      ...partial,
      fillId: crypto.randomUUID(),
      economics: { ...partial.economics, quantity: "0.05000000" },
    });

    expect(compareDecimal(second.positions.BTCUSDT?.quantity ?? "0", "0.1")).toBe(0);
    expect(compareDecimal(second.positions.BTCUSDT!.grossPositionBasis, "1000")).toBe(0);
    expect(compareDecimal(second.positions.BTCUSDT!.netPositionBasis, "1003.5")).toBe(0);
  });

  it("sell partial realizes gross and net", () => {
    const buy = makeAccountingEconomicsFill("buy");
    const afterBuy = advanceFill(baseState(), buy, { marks: BTC_MARKS });
    const sell = makeAccountingEconomicsFill("sell", { sliceQuantity: "0.05000000" });
    const afterSell = advanceFill(frontierToState(afterBuy), sell, { marks: BTC_MARKS });

    expect(compareDecimal(afterSell.grossRealizedPnl, "0")).toBe(0);
    expect(compareDecimal(afterSell.netRealizedPnl, "-3.5")).toBe(0);
    expect(compareDecimal(afterSell.positions.BTCUSDT?.quantity ?? "0", "0.05")).toBe(0);
  });

  it("sell full close", () => {
    const buy = makeAccountingEconomicsFill("buy");
    const afterBuy = advanceFill(baseState(), buy, { marks: BTC_MARKS });
    const sell = makeAccountingEconomicsFill("sell");
    const afterSell = advanceFill(frontierToState(afterBuy), sell, { marks: BTC_MARKS });
    const pos = afterSell.positions.BTCUSDT!;

    expect(pos.quantity).toBe("0");
    expect(pos.grossPositionBasis).toBe("0");
    expect(pos.netPositionBasis).toBe("0");
    expect(compareDecimal(afterSell.netRealizedPnl, "-7")).toBe(0);
  });

  it("cancelled with executed qty", () => {
    const executed = makeAccountingEconomicsFill("buy", {
      sliceQuantity: "0.04000000",
      remainingQuantityAfter: "0.06000000",
    });
    const frontier = advanceFill(baseState(), executed);

    expect(compareDecimal(frontier.positions.BTCUSDT?.quantity ?? "0", "0.04")).toBe(0);
    expect(
      compareDecimal(
        frontier.cash,
        subtractDecimal(HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT, "401.4"),
      ),
    ).toBe(0);
    expect(frontier.consumedFillIds).toHaveLength(1);
  });

  it("expired with executed qty", () => {
    const executed = makeAccountingEconomicsFill("buy", {
      sliceQuantity: "0.03000000",
      remainingQuantityAfter: "0.07000000",
    });
    const frontier = advanceFill(baseState(), executed);

    expect(compareDecimal(frontier.positions.BTCUSDT?.quantity ?? "0", "0.03")).toBe(0);
    expect(compareDecimal(frontier.positions.BTCUSDT!.grossPositionBasis, "300")).toBe(0);
    expect(frontier.consumedFillIds).toHaveLength(1);
  });

  it("fee spread impact consumed once", () => {
    const buy = makeAccountingEconomicsFill("buy");
    const afterBuy = advanceFill(baseState(), buy);
    const sell = makeAccountingEconomicsFill("sell");
    const afterSell = advanceFill(frontierToState(afterBuy), sell);

    const realizedCostGap = subtractDecimal(afterSell.grossRealizedPnl, afterSell.netRealizedPnl);
    expect(compareDecimal(realizedCostGap, "7")).toBe(0);
    expect(compareDecimal(buy.economics.totalExecutionCost, "3.5")).toBe(0);
    expect(compareDecimal(sell.economics.totalExecutionCost, "3.5")).toBe(0);
  });

  it("net cash effect conservation direct consumption", () => {
    const fills = [
      makeAccountingEconomicsFill("buy"),
      makeAccountingEconomicsFill("buy", {
        symbol: "ETHUSDT",
        grossFillPrice: "3000",
        sliceQuantity: "0.50000000",
      }),
      makeAccountingEconomicsFill("sell", { sliceQuantity: "0.05000000" }),
    ];

    let state = baseState();
    let cashDelta = "0";
    for (const fill of fills) {
      cashDelta = addDecimal(cashDelta, fill.economics.netCashEffect);
      const frontier = advanceFill(state, fill);
      state = frontierToState(frontier);
    }

    expect(
      compareDecimal(
        state.cash,
        addDecimal(HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT, cashDelta),
      ),
    ).toBe(0);
  });

  it("dual gross net weighted average basis", () => {
    const first = makeAccountingEconomicsFill("buy", {
      sliceQuantity: "0.10000000",
      grossFillPrice: "10000",
    });
    const second = makeAccountingEconomicsFill("buy", {
      sliceQuantity: "0.10000000",
      grossFillPrice: "11000",
    });
    let state = baseState();
    state = frontierToState(advanceFill(state, first));
    const frontier = advanceFill(state, { ...second, fillId: crypto.randomUUID() });
    const pos = frontier.positions.BTCUSDT!;
    const firstNetBasis = addDecimal(
      multiplyDecimal(first.economics.netFillPrice, first.economics.quantity),
      first.economics.feeAmount,
    );
    const secondNetBasis = addDecimal(
      multiplyDecimal(second.economics.netFillPrice, second.economics.quantity),
      second.economics.feeAmount,
    );

    expect(compareDecimal(pos.quantity, "0.2")).toBe(0);
    expect(compareDecimal(pos.grossPositionBasis, "2100")).toBe(0);
    expect(compareDecimal(pos.netPositionBasis, addDecimal(firstNetBasis, secondNetBasis))).toBe(0);
    expect(
      compareDecimal(
        subtractDecimal(pos.netPositionBasis, pos.grossPositionBasis),
        addDecimal(first.economics.totalExecutionCost, second.economics.totalExecutionCost),
      ),
    ).toBe(0);
  });

  it("multi symbol 1m chronology", () => {
    const btcFill = makeAccountingEconomicsFill("buy", {
      fillTimestamp: new Date("2026-01-01T00:01:59.999Z"),
    });
    const ethFill = makeAccountingEconomicsFill("buy", {
      symbol: "ETHUSDT",
      grossFillPrice: "3000",
      sliceQuantity: "1.00000000",
      fillTimestamp: new Date("2026-01-01T00:02:59.999Z"),
    });

    const state = baseState();
    const seq1 = advanceFill(state, btcFill, {
      frontierAsOf: "2026-01-01T00:01:59.999Z",
      marks: { BTCUSDT: BTC_MARK },
    });
    const seq2 = advanceFill(frontierToState(seq1), ethFill, {
      frontierAsOf: "2026-01-01T00:02:59.999Z",
      marks: { BTCUSDT: BTC_MARK, ETHUSDT: ETH_MARK },
    });

    expect(seq1.accountingSequence).toBe(2);
    expect(seq2.accountingSequence).toBe(3);
    expect(seq2.frontierAsOf).toBe("2026-01-01T00:02:59.999Z");
    expect(seq2.marks.BTCUSDT?.price).toBe("50000");
    expect(seq2.marks.ETHUSDT?.price).toBe("3000");
    expect(compareDecimal(seq2.markedPositionValue, "8000")).toBe(0);
  });

  it("HWM monotonicity bps", () => {
    const buy = makeAccountingEconomicsFill("buy");
    let state = baseState();
    const hwms: string[] = [state.equityHwm];

    const afterBuy = advanceFill(state, buy, { frontierAsOf: "2026-01-01T00:01:59.999Z" });
    hwms.push(afterBuy.equityHwm);
    state = frontierToState(afterBuy);

    const afterMarkUp = advanceMark(state, BTC_MARKS, "2026-01-01T00:02:59.999Z");
    hwms.push(afterMarkUp.equityHwm);
    state = frontierToState(afterMarkUp);

    const lowerMark = { BTCUSDT: { price: "45000", barCloseTime: "2026-01-01T00:03:59.999Z" } };
    const afterMarkDown = advanceMark(state, lowerMark, "2026-01-01T00:03:59.999Z");
    hwms.push(afterMarkDown.equityHwm);

    for (let i = 1; i < hwms.length; i++) {
      expect(compareDecimal(hwms[i]!, hwms[i - 1]!)).toBeGreaterThanOrEqual(0);
    }
  });

  it("monthly HWM UTC boundary", () => {
    const buy = makeAccountingEconomicsFill("buy");
    const state = baseState();
    const jan = advanceFill(state, buy, {
      marks: BTC_MARKS,
      frontierAsOf: "2026-01-31T23:59:59.999Z",
    });
    expect(jan.monthKey).toBe("2026-01");
    expect(resolveMonthKeyUtc("2026-01-31T23:59:59.999Z")).toBe("2026-01");

    const feb = advanceMark(frontierToState(jan), BTC_MARKS, "2026-02-01T00:00:00.000Z");
    expect(feb.monthKey).toBe("2026-02");
    expect(resolveMonthKeyUtc("2026-02-01T00:00:00.000Z")).toBe("2026-02");
  });

  it("drawdown equality at threshold bps", () => {
    const cashOnlyDrawdownFill: AccountingFillInput = {
      fillId: crypto.randomUUID(),
      executedAt: "2026-01-01T00:01:59.999Z",
      economics: {
        symbol: "BTCUSDT",
        side: "buy",
        quantity: "2.5",
        grossFillPrice: "10000",
        grossNotional: "25000",
        netFillPrice: "10000",
        feeAmount: "0",
        netCashEffect: "-25000",
        spreadCost: "0",
        impactSlippageCost: "0",
        totalExecutionCost: "0",
        economicsContentDigest: "0".repeat(64),
      },
    };
    const frontier = advanceFill(baseState(), cashOnlyDrawdownFill, {
      frontierAsOf: "2026-01-01T00:01:59.999Z",
    });

    expect(compareDecimal(frontier.equity, "75000")).toBe(0);
    expect(compareDecimal(frontier.equityHwm, "100000")).toBe(0);
    expect(frontier.accountDrawdownBps).toBe(2500);
    expect(computePeakEquityDrawdownBps(frontier.equity, frontier.equityHwm)).toBe(2500);
  });

  it("restart parity frontier", async () => {
    const repo = createAccountingFrontierRepositoryMemory();
    const context = { organizationId: ORG_ID };
    const buy = makeAccountingEconomicsFill("buy");
    const checkpoint = advanceFill(baseState(), buy, { marks: BTC_MARKS });
    await repo.append(context, checkpoint);

    const loaded = await repo.loadLatest(context, { accountKey: ACCOUNT_KEY, runId: RUN_ID });
    expect(loaded).not.toBeNull();

    const sell = makeAccountingEconomicsFill("sell");
    const continuous = advanceFill(frontierToState(checkpoint), sell, { marks: BTC_MARKS });
    const restarted = advanceFill(frontierToState(loaded!), sell, { marks: BTC_MARKS });

    expect(restarted.semanticContentDigest).toBe(continuous.semanticContentDigest);
    expect(restarted.cash).toBe(continuous.cash);
    expect(restarted.netRealizedPnl).toBe(continuous.netRealizedPnl);
  });

  it("checkpoint parity", async () => {
    const repo = createAccountingFrontierRepositoryMemory();
    const context = { organizationId: ORG_ID };
    const fill = makeAccountingEconomicsFill("buy");
    const frontier = advanceFill(baseState(), fill, { marks: BTC_MARKS });
    const stored = await repo.append(context, frontier);
    const loaded = await repo.loadLatest(context, { accountKey: ACCOUNT_KEY, runId: RUN_ID });

    expect(stored.accountingSequence).toBe(frontier.accountingSequence);
    expect(stored.marks).toEqual({ BTCUSDT: BTC_MARK });
    expect(loaded?.accountingSequence).toBe(2);
    expect(loaded?.marks.BTCUSDT?.price).toBe("50000");
    expect(loaded?.semanticContentDigest).toBe(frontier.semanticContentDigest);
  });

  it("sqlite postgres semantic parity", () => {
    const fill = makeAccountingEconomicsFill("buy");
    const frontier = advanceFill(baseState(), fill, { marks: BTC_MARKS });
    const row = accountingFrontierToRow(frontier);
    const roundTripped = accountingRowToFrontier(row, frontier.consumedFillIds);

    expect(roundTripped.cash).toBe(frontier.cash);
    expect(roundTripped.positions).toEqual(frontier.positions);
    expect(roundTripped.marks).toEqual(frontier.marks);
    expect(roundTripped.semanticContentDigest).toBe(frontier.semanticContentDigest);
    expect(roundTripped.equity).toBe(frontier.equity);
    expect(roundTripped.monthKey).toBe(frontier.monthKey);
    expect(roundTripped.markedPositionValue).toBe(frontier.markedPositionValue);
    expect(roundTripped.monthlyPeakHwm).toBe(frontier.monthlyPeakHwm);
    expect(roundTripped.monthlyDrawdownBps).toBe(frontier.monthlyDrawdownBps);
    expect(roundTripped.strategyPeakHwmByKey).toEqual(frontier.strategyPeakHwmByKey);
    expect(roundTripped.strategyDrawdownBpsByKey).toEqual(frontier.strategyDrawdownBpsByKey);
    expect(computeAccountingSemanticDigest(roundTripped)).toBe(frontier.semanticContentDigest);
    expect(roundTripped.accountDrawdownBps).toBe(frontier.accountDrawdownBps);
    expect(frontier.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("idempotency same key same content", async () => {
    const repo = createAccountingFrontierRepositoryMemory();
    const context = { organizationId: ORG_ID };
    const fill = makeAccountingEconomicsFill("buy");
    const frontier = advanceFill(baseState(), fill);
    const first = await repo.append(context, frontier);
    const second = await repo.append(context, frontier);

    expect(second.id).toBe(first.id);
    expect(second.semanticContentDigest).toBe(first.semanticContentDigest);
    expect(() =>
      assertAccountingIdempotency(
        first.semanticContentDigest,
        frontier.semanticContentDigest,
        frontier.idempotencyKey,
      ),
    ).not.toThrow();
  });

  it("same key different content fail closed", async () => {
    const repo = createAccountingFrontierRepositoryMemory();
    const context = { organizationId: ORG_ID };
    const fill = makeAccountingEconomicsFill("buy");
    const frontier = advanceFill(baseState(), fill);
    await repo.append(context, frontier);

    const conflicting = {
      ...frontier,
      cash: subtractDecimal(frontier.cash, "1"),
      semanticContentDigest: computeAccountingSemanticDigest({
        ...frontierToState(frontier),
        cash: subtractDecimal(frontier.cash, "1"),
      }),
    };

    await expect(repo.append(context, conflicting)).rejects.toThrow(
      AccountingIdempotencyConflictError,
    );
  });

  it("deterministic pnl report digest", () => {
    const fill = makeAccountingEconomicsFill("buy");
    const frontier = advanceFill(baseState(), fill, { marks: BTC_MARKS });
    const report = buildHtrPnlReportV1({
      state: frontierToState(frontier),
      semanticDigest: frontier.semanticContentDigest,
    });
    const digestA = computeHtrPnlReportDigest(report);
    const digestB = computeHtrPnlReportDigest(report);

    expect(digestA).toBe(digestB);
    expect(digestA).toMatch(/^[0-9a-f]{64}$/);
  });

  it("missing mark fail closed", () => {
    const buy = makeAccountingEconomicsFill("buy");
    const afterBuy = advanceFill(baseState(), buy);
    expect(() =>
      advanceAccountingFrontier({
        state: frontierToState(afterBuy),
        marks: {},
        frontierAsOf: "2026-01-01T00:02:59.999Z",
      }),
    ).toThrow(AccountingInvariantError);
  });

  it("gross unrealized pnl identity", () => {
    const buy = makeAccountingEconomicsFill("buy");
    const frontier = advanceFill(baseState(), buy, { marks: BTC_MARKS });
    const state = frontierToState(frontier);
    const gross = grossUnrealizedPnl(state);

    expect(compareDecimal(gross, subtractDecimal(state.markedPositionValue, "1000"))).toBe(0);
    expect(compareDecimal(gross, "4000")).toBe(0);
  });

  it("net unrealized pnl identity", () => {
    const buy = makeAccountingEconomicsFill("buy");
    const frontier = advanceFill(baseState(), buy, { marks: BTC_MARKS });
    const state = frontierToState(frontier);
    const net = netUnrealizedPnl(state);

    expect(compareDecimal(net, subtractDecimal(state.markedPositionValue, "1003.5"))).toBe(0);
    expect(compareDecimal(net, "3996.5")).toBe(0);
  });

  it("cash equity conservation", () => {
    const buy = makeAccountingEconomicsFill("buy");
    const afterBuy = advanceFill(baseState(), buy, { marks: BTC_MARKS });
    const sell = makeAccountingEconomicsFill("sell", { sliceQuantity: "0.05000000" });
    const frontier = advanceFill(frontierToState(afterBuy), sell, { marks: BTC_MARKS });
    const state = frontierToState(frontier);
    const startingEquity = HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT;

    expect(compareDecimal(state.equity, addDecimal(state.cash, state.markedPositionValue))).toBe(0);
    expect(
      compareDecimal(
        state.equity,
        addDecimal(addDecimal(startingEquity, state.netRealizedPnl), netUnrealizedPnl(state)),
      ),
    ).toBe(0);
  });
});
