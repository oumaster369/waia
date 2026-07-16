import { describe, expect, it } from "vitest";

import { DEFAULT_PORTFOLIO_RUN_CONFIG } from "@/lib/trader/portfolio/portfolio-run-config.types";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import { FHV_V0_TOTAL_VIRTUAL_EQUITY_USDT } from "@/lib/trader/risk/strategy-attribution";
import {
  buildResearchV2PortfolioContext,
  resolveResearchPortfolioConfig,
} from "@/lib/trader/research/research-portfolio-config";
import {
  assertHtrInitialPortfolioContract,
  computeHtrInitialPortfolioSemanticDigest,
  createHtrInitialAccountRiskState,
  createHtrInitialPortfolioAccountState,
  HTR_INITIAL_PORTFOLIO_CONTRACT_V1,
  HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
} from "@/lib/trader/research/htr-initial-portfolio-contract";

describe("HTR initial portfolio contract", () => {
  it("defines canonical 100k USDT shared spot portfolio with zero BTC/ETH", () => {
    expect(HTR_INITIAL_PORTFOLIO_CONTRACT_V1).toMatchObject({
      schemaVersion: "htr-initial-portfolio/v1",
      startingBalanceUsdt: "100000.00",
      startingPositions: { BTC: "0", ETH: "0" },
      market: "SPOT",
      sharedPortfolio: true,
      leverageAllowed: false,
      borrowingAllowed: false,
      shortingAllowed: false,
      externalCashFlowsAllowed: false,
    });
  });

  it("seeds portfolio account state at canonical initial chronology", () => {
    const state = createHtrInitialPortfolioAccountState();
    assertHtrInitialPortfolioContract(state);
    expect(state.availableBalanceUsdt).toBe("100000.00");
    expect(state.equityUsdt).toBe("100000.00");
    expect(state.realizedPnlUsdt).toBe("0");
    expect(state.markedPnlUsdt).toBe("0");
    expect(state.feesPaidUsdt).toBe("0");
    expect(state.positions).toEqual([]);
  });

  it("seeds V1 account risk state with canonical balance fields", () => {
    const risk = createHtrInitialAccountRiskState();
    expect(risk.availableBalanceUsdt).toBe("100000.00");
    expect(risk.equityUsdt).toBe("100000.00");
    expect(risk.positions).toEqual([]);
    expect(risk.openOrderCount).toBe(0);
  });

  it("binds default portfolio run config and research V2 defaults to the same contract", () => {
    const resolved = resolveResearchPortfolioConfig();
    expect(resolved.startingBalanceUsdt).toBe(HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT);
    expect(DEFAULT_PORTFOLIO_RUN_CONFIG.startingBalanceUsdt).toBe(
      HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
    );

    const portfolio = buildResearchV2PortfolioContext(createCostModelV1("10", "5"));
    assertHtrInitialPortfolioContract(
      createHtrInitialPortfolioAccountState({
        runConfig: portfolio.runConfig,
        limits: portfolio.limits,
      }),
    );
  });

  it("aliases FHV strategy-attribution total virtual equity to the canonical contract", () => {
    expect(FHV_V0_TOTAL_VIRTUAL_EQUITY_USDT).toBe(HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT);
  });

  it("produces stable semantic digests for V1 and V2 initial states", () => {
    const v1Digest = computeHtrInitialPortfolioSemanticDigest();
    const v2Portfolio = buildResearchV2PortfolioContext(createCostModelV1("10", "5"));
    const v2State = createHtrInitialPortfolioAccountState({
      runConfig: v2Portfolio.runConfig,
      limits: v2Portfolio.limits,
    });
    assertHtrInitialPortfolioContract(v2State);
    const v2Digest = computeHtrInitialPortfolioSemanticDigest();
    expect(v1Digest).toBe(v2Digest);
  });
});
