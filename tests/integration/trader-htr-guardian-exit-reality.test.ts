import { describe, expect, it } from "vitest";

import { advanceAccountingFrontier, createInitialAccountingState } from "@/lib/trader/accounting";
import { HTR_GUARDIAN_EXIT_REASON_V1 } from "@/lib/trader/guardian/htr-guardian-exit-taxonomy";
import { evaluateHtrGuardianCycle } from "@/lib/trader/guardian/htr-guardian-risk-bridge";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";
import {
  BTC_MARK,
  makeAccountingEconomicsFill,
} from "@/tests/unit/helpers/htr-accounting-fixtures";

describe("HTR-WP20 guardian exit reality integration", () => {
  it("reconciliation runs before guardian and passes on valid cycle", () => {
    const state = createInitialAccountingState({
      organizationId: "00000000-0000-4000-8000-0000000420i1",
      accountKey: "integration",
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
        cashEvents: [{ fillId: buy.fillId, netCashEffect: buy.economics.netCashEffect }],
      },
      accountPeakHwm: frontier.equityHwm,
      monthlyPeakHwm: frontier.equityHwm,
      equityUsdt: frontier.equity,
    });
    expect(cycle.breachState).toBe("NONE");
    expect(cycle.allowNewExposure).toBe(true);
  });

  it("missing mark cannot widen risk", () => {
    const state = createInitialAccountingState({
      organizationId: "00000000-0000-4000-8000-0000000420i1",
      accountKey: "integration",
      runId: "run",
    });
    const cycle = evaluateHtrGuardianCycle({
      reconciliation: {
        state,
        startingEquityUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
        startingCashUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      },
      accountPeakHwm: state.equityHwm,
      monthlyPeakHwm: state.equityHwm,
      equityUsdt: state.equity,
      missingMark: true,
    });
    expect(cycle.breachState).toBe("STOP_ACCOUNT");
    expect(cycle.reason).toBe(HTR_GUARDIAN_EXIT_REASON_V1.missingMark);
    expect(cycle.allowNewExposure).toBe(false);
  });
});
