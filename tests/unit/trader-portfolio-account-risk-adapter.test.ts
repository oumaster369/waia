import { describe, expect, it } from "vitest";

import { createInitialPortfolioAccountState } from "@/lib/trader/portfolio/derive-portfolio-account-state";
import { defaultStopDistanceProvider } from "@/lib/trader/portfolio/default-stop-distance-provider";
import { DEFAULT_PORTFOLIO_RUN_CONFIG } from "@/lib/trader/portfolio/portfolio-run-config.types";
import { toAccountRiskState } from "@/lib/trader/portfolio/to-account-risk-state";

describe("toAccountRiskState (M2 adapter)", () => {
  it("maps portfolio ledger into AccountRiskState with USDT exposure", () => {
    const portfolio = createInitialPortfolioAccountState({
      runConfig: DEFAULT_PORTFOLIO_RUN_CONFIG,
      limits: {
        maxRiskPerTradePct: "0.01",
        maxPortfolioRiskPct: "0.05",
        maxConcurrentPositions: 3,
        maxNotional: "10000",
      },
      stopDistanceProvider: defaultStopDistanceProvider,
    });

    const state = toAccountRiskState({ portfolio, openOrderCount: 0 });

    expect(state.availableBalanceUsdt).toBe("100000.00");
    expect(state.equityUsdt).toBe("100000.00");
    expect(state.openRiskUsdt).toBe("0");
    expect(state.quoteExposureByCurrency.USDT).toBe("0");
    expect(state.dailyPnl).toBe("0");
    expect(state.drawdown).toBe("0");
  });
});
