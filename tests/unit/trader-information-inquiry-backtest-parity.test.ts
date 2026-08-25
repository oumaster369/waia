import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  runBacktest,
  type RunBacktestInput,
} from "@/lib/trader/backtest/backtest-runner";

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

  it("rejects a blind-split inquiry resolver before it can read holdout-derived context", async () => {
    const informationInquiryResolver = vi.fn();

    await expect(
      runBacktest({
        split: "blind",
        informationInquiryResolver,
      } as unknown as RunBacktestInput),
    ).rejects.toThrow("INFORMATION_INQUIRY_RUNTIME_FORBIDDEN:blindHoldout");
    expect(informationInquiryResolver).not.toHaveBeenCalled();
  });

  it("rejects a blind PROFILE_RECEIPT before reading bars or starting a cycle", async () => {
    const next = vi.fn();
    const reset = vi.fn();

    await expect(
      runBacktest({
        split: "blind",
        barSource: { next, reset },
        informationSufficiencyAuthority: {
          kind: "PROFILE_RECEIPT",
        },
      } as unknown as RunBacktestInput),
    ).rejects.toThrow("INFORMATION_SUFFICIENCY_PROFILE_RECEIPT_FORBIDDEN:blindHoldout");
    expect(next).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
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
