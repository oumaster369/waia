import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  advanceAccountingFrontier,
  buildHtrPnlReportV1,
  computeAccountingSemanticDigest,
  createInitialAccountingState,
} from "@/lib/trader/accounting";
import {
  assertAccountingReconciliation,
  buildHistoricalRealityReconciliationReport,
  reconcileAccountingInvariants,
} from "@/lib/trader/accounting/accounting-reconciliation";
import { accountingInvariantCodes } from "@/lib/trader/accounting/accounting-invariant-codes";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import {
  BTC_MARK,
  makeAccountingEconomicsFill,
} from "@/tests/unit/helpers/htr-accounting-fixtures";

const ORG = "00000000-0000-4000-8000-0000000419d1";

describe("HTR-WP19 accounting reconciliation invariants", () => {
  it("cash + markedPositionValue = equity", () => {
    const state = createInitialAccountingState({
      organizationId: ORG,
      accountKey: "acct",
      runId: "run",
    });
    const buy = makeAccountingEconomicsFill("buy");
    const frontier = advanceAccountingFrontier({
      state,
      fill: buy,
      marks: { BTCUSDT: BTC_MARK },
      frontierAsOf: buy.executedAt,
    });
    const result = reconcileAccountingInvariants({
      state: frontier,
      startingEquityUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      startingCashUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
    });
    expect(result.pass).toBe(true);
  });

  it("startingEquity + netResult = terminalEquity", () => {
    const state = createInitialAccountingState({
      organizationId: ORG,
      accountKey: "acct",
      runId: "run",
    });
    const buy = makeAccountingEconomicsFill("buy");
    const afterBuy = advanceAccountingFrontier({
      state,
      fill: buy,
      marks: { BTCUSDT: BTC_MARK },
      frontierAsOf: buy.executedAt,
    });
    const sell = makeAccountingEconomicsFill("sell");
    const frontier = advanceAccountingFrontier({
      state: afterBuy,
      fill: sell,
      marks: { BTCUSDT: BTC_MARK },
      frontierAsOf: sell.executedAt,
    });
    const result = reconcileAccountingInvariants({
      state: frontier,
      startingEquityUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      startingCashUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
    });
    expect(result.pass).toBe(true);
  });

  it("reconciliation fail-closed on inventory mismatch", () => {
    const state = createInitialAccountingState({
      organizationId: ORG,
      accountKey: "acct",
      runId: "run",
    });
    const buy = makeAccountingEconomicsFill("buy");
    const frontier = advanceAccountingFrontier({
      state,
      fill: buy,
      marks: { BTCUSDT: BTC_MARK },
      frontierAsOf: buy.executedAt,
    });
    const result = reconcileAccountingInvariants({
      state: frontier,
      startingEquityUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      startingCashUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      inventoryOpenQtyBySymbol: { BTCUSDT: "0.999" },
    });
    expect(result.pass).toBe(false);
    expect(result.violations[0]?.code).toBe(accountingInvariantCodes.inventoryParity);
  });

  it("PnL report terminal values match accounting state", () => {
    const state = createInitialAccountingState({
      organizationId: ORG,
      accountKey: "acct",
      runId: "run",
    });
    const buy = makeAccountingEconomicsFill("buy");
    const frontier = advanceAccountingFrontier({
      state,
      fill: buy,
      marks: { BTCUSDT: BTC_MARK },
      frontierAsOf: buy.executedAt,
    });
    const report = buildHtrPnlReportV1({
      state: frontier,
      semanticDigest: computeAccountingSemanticDigest(frontier),
    });
    const result = reconcileAccountingInvariants({
      state: frontier,
      startingEquityUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      startingCashUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      pnlReport: report,
    });
    expect(result.pass).toBe(true);
  });

  it("buildHistoricalRealityReconciliationReport includes terminal fields", () => {
    const state = createInitialAccountingState({
      organizationId: ORG,
      accountKey: "acct",
      runId: "run",
    });
    const report = buildHistoricalRealityReconciliationReport({
      state,
      startingEquityUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      startingCashUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
    });
    expect(report.pass).toBe(true);
    expect(compareDecimal(report.terminalEquityUsdt, state.equity)).toBe(0);
    expect(compareDecimal(report.terminalCashUsdt, state.cash)).toBe(0);
  });

  it("assertAccountingReconciliation throws on failure", () => {
    const state = createInitialAccountingState({
      organizationId: ORG,
      accountKey: "acct",
      runId: "run",
    });
    expect(() =>
      assertAccountingReconciliation({
        state: { ...state, equity: "99999" },
        startingEquityUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
        startingCashUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      }),
    ).toThrow(/fail-closed/);
  });
});
