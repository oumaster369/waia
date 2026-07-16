import { describe, expect, it } from "vitest";

import { advanceAccountingFrontier, createInitialAccountingState } from "@/lib/trader/accounting";
import { assertAccountingReconciliation } from "@/lib/trader/accounting/accounting-reconciliation";
import {
  HTR_GUARDIAN_EXIT_REASON_V1,
  resolveDrawdownBreachState,
} from "@/lib/trader/guardian/htr-guardian-exit-taxonomy";
import {
  applyBreachSubmissionRestrictions,
  evaluateHtrGuardianCycle,
} from "@/lib/trader/guardian/htr-guardian-risk-bridge";
import { DEFAULT_D20_DRAWDOWN_POLICY } from "@/lib/trader/risk/drawdown-policy.types";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";
import {
  BTC_MARK,
  makeAccountingEconomicsFill,
} from "@/tests/unit/helpers/htr-accounting-fixtures";

describe("HTR-WP20 guardian drawdown interaction", () => {
  it("threshold equality triggers CLOSE_ONLY", () => {
    const resolved = resolveDrawdownBreachState({
      accountDrawdownBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps,
      monthlyDrawdownBps: 0,
      accountLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps,
      monthlyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps,
    });
    expect(resolved.breachState).toBe("CLOSE_ONLY");
    expect(resolved.reason).toBe(HTR_GUARDIAN_EXIT_REASON_V1.accountDrawdownEquality);
  });

  it("hard breach triggers STOP_ACCOUNT", () => {
    const resolved = resolveDrawdownBreachState({
      accountDrawdownBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps + 1,
      monthlyDrawdownBps: 0,
      accountLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps,
      monthlyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps,
    });
    expect(resolved.breachState).toBe("STOP_ACCOUNT");
    expect(resolved.reason).toBe(HTR_GUARDIAN_EXIT_REASON_V1.accountDrawdownBreach);
  });

  it("reconciliation failure triggers STOP_ACCOUNT", () => {
    const state = createInitialAccountingState({
      organizationId: "00000000-0000-4000-8000-0000000420d1",
      accountKey: "guardian",
      runId: "run",
    });
    const cycle = evaluateHtrGuardianCycle({
      reconciliation: {
        state: { ...state, equity: "1" },
        startingEquityUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
        startingCashUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      },
      accountPeakHwm: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      monthlyPeakHwm: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      equityUsdt: "1",
    });
    expect(cycle.breachState).toBe("STOP_ACCOUNT");
    expect(cycle.reason).toBe(HTR_GUARDIAN_EXIT_REASON_V1.reconciliationFailure);
  });

  it("no new exposure after breach", () => {
    const state = createInitialAccountingState({
      organizationId: "00000000-0000-4000-8000-0000000420d1",
      accountKey: "guardian",
      runId: "run",
    });
    const buy = makeAccountingEconomicsFill("buy");
    const frontier = advanceAccountingFrontier({
      state,
      fill: buy,
      marks: { BTCUSDT: BTC_MARK },
      frontierAsOf: buy.executedAt,
    });
    const cycle = evaluateHtrGuardianCycle({
      reconciliation: {
        state: frontier,
        startingEquityUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
        startingCashUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      },
      accountPeakHwm: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      monthlyPeakHwm: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      equityUsdt: "75000",
      missingMark: false,
    });
    const restriction = applyBreachSubmissionRestrictions({
      cycle: { ...cycle, breachState: "STOP_ACCOUNT", allowNewExposure: false },
      order: {
        symbol: "BTCUSDT",
        side: "buy",
        type: "market",
        quantity: "0.1",
        clientOrderId: "c1",
      },
      openQty: "0.1",
    });
    expect(restriction.permitted).toBe(false);
  });

  it("risk-reducing exits remain permitted on STOP_ACCOUNT", () => {
    const cycle = evaluateHtrGuardianCycle({
      reconciliation: {
        state: createInitialAccountingState({
          organizationId: "00000000-0000-4000-8000-0000000420d1",
          accountKey: "guardian",
          runId: "run",
        }),
        startingEquityUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
        startingCashUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      },
      accountPeakHwm: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      monthlyPeakHwm: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      equityUsdt: "50000",
      missingMark: true,
    });
    const restriction = applyBreachSubmissionRestrictions({
      cycle,
      order: {
        symbol: "BTCUSDT",
        side: "sell",
        type: "market",
        quantity: "0.1",
        clientOrderId: "c2",
      },
      openQty: "0.1",
    });
    expect(restriction.permitted).toBe(true);
  });
});
