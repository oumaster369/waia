import { describe, expect, it } from "vitest";

import { buildResearchGuardianContext } from "@/lib/trader/research/research-guardian-config";
import {
  buildResearchV2PortfolioContext,
  DEFAULT_RESEARCH_V2_STARTING_BALANCE_USDT,
  resolveResearchPortfolioConfig,
} from "@/lib/trader/research/research-portfolio-config";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import {
  parseM9MetricsSchemaVersion,
  parseM9PortfolioConfig,
} from "@/lib/trader/research/m9-campaign-flags";
import { RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION } from "@/lib/trader/research/strategy-candidate.types";

describe("M9 research portfolio config", () => {
  it("defaults starting balance to 1M USDT", () => {
    const resolved = resolveResearchPortfolioConfig();
    expect(resolved.startingBalanceUsdt).toBe(DEFAULT_RESEARCH_V2_STARTING_BALANCE_USDT);
  });

  it("builds portfolio context with CLI overrides", () => {
    const costModel = createCostModelV1("10", "5");
    const portfolio = buildResearchV2PortfolioContext(costModel, {
      startingBalanceUsdt: "500000.00",
      defaultStopDistancePct: "0.03",
    });
    expect(portfolio.runConfig.startingBalanceUsdt).toBe("500000.00");
    expect(portfolio.runConfig.defaultStopDistancePct).toBe("0.03");
  });

  it("parses portfolio flags and env override", () => {
    const flags = new Map<string, string>([
      ["starting-balance-usdt", "250000.00"],
      ["max-risk-per-trade-pct", "0.05"],
    ]);
    const config = parseM9PortfolioConfig(flags);
    expect(config.startingBalanceUsdt).toBe("250000.00");
    expect(config.maxRiskPerTradePct).toBe("0.05");
  });

  it("requires metrics schema version 2.0.0 for M9", () => {
    const flags = new Map<string, string>([
      ["metrics-schema-version", RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION],
    ]);
    expect(parseM9MetricsSchemaVersion(flags)).toBe(RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION);
    expect(() =>
      parseM9MetricsSchemaVersion(new Map([["metrics-schema-version", "1.0.0"]])),
    ).toThrow(/must be 2.0.0/);
  });
});

describe("M9 research guardian config", () => {
  it("returns undefined when disabled", () => {
    expect(buildResearchGuardianContext({ enabled: false })).toBeUndefined();
  });

  it("wires exit engine when enabled", () => {
    const guardian = buildResearchGuardianContext({
      enabled: true,
      enableExitEngine: true,
    });
    expect(guardian?.runConfig.enabled).toBe(true);
    expect(guardian?.exitEngine?.runConfig.enabled).toBe(true);
  });
});
