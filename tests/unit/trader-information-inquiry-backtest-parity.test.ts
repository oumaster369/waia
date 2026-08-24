import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("DEE-699 historical inquiry parity", () => {
  it("routes canonical runBacktest through the network-inert PIT replay selector", () => {
    const source = readFileSync(resolve(root, "lib/trader/backtest/backtest-runner.ts"), "utf8");
    expect(source).toContain("selectInformationNeedReplayEvidenceV1");
    expect(source).toContain("assertInformationInquiryRuntimeScopeV1");
    expect(
      source.indexOf(
        "assertInformationInquiryRuntimeScopeV1",
        source.indexOf("let cycleInformationSufficiencyAuthority"),
      ),
    ).toBeLessThan(
      source.indexOf(
        "selectInformationNeedReplayEvidenceV1({",
        source.indexOf("let cycleInformationSufficiencyAuthority"),
      ),
    );
    expect(source).toContain('mode: "HISTORICAL"');
    expect(source).toContain("informationInquiryResolver");
    expect(source).not.toContain("MarketDataGateway");
    expect(source).not.toContain("HtxBarPollSource");
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });

  it("keeps the composition runtime free of live provider and downstream authority imports", () => {
    const source = readFileSync(
      resolve(
        root,
        "lib/trader/intelligence/information-inquiry/information-inquiry-runtime-v1.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(
      /from\s+"[^"]*(market-data-gateway|htx|binance|bybit|forecast|decision|execution)[^"]*"/i,
    );
    expect(source).toContain("createsKnowledgeHypothesisForecastDecisionOrCapitalAuthority: false");
  });
});
