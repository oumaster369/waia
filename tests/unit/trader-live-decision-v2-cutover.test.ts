import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("lib/trader/live/run-live-cycle.ts", "utf8");

describe("DEE-780 live-equivalent Decision V2 cutover", () => {
  it("has no StrategySignal-to-order mapper ingress", () => {
    expect(source).not.toContain("mapSignalToLiveSubmitOrder");
    expect(source).toContain("runDecisionCapitalAuthorityV2");
  });

  it("accepts only long-entry tactical proposals and fails closed without V2 authority", () => {
    expect(source).toContain('entry.side === "buy"');
    expect(source).toContain('skipReason: "decision_v2_authority_missing"');
    expect(source).toContain('skipReason: "decision_v2_no_trade"');
  });
});
