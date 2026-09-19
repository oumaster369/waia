import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("lib/trader/paper/paper-cycle-runner.ts", "utf8");

describe("DEE-780 paper Decision V2 cutover", () => {
  it("routes capital-shaped paper entry through the canonical recurring cycle before legacy research mapping", () => {
    const authorityBranch = source.indexOf('executionMode === "paper"');
    const authorityCall = source.indexOf("runCanonicalOrdinaryCapitalCycleV2", authorityBranch);
    const legacyMapper = source.indexOf("mapSignalToSubmitOrder({", authorityBranch);

    expect(authorityBranch).toBeGreaterThan(-1);
    expect(authorityCall).toBeGreaterThan(authorityBranch);
    expect(legacyMapper).toBeGreaterThan(authorityCall);
    expect(source).not.toContain("runDecisionCapitalAuthorityV2");
  });

  it("fails closed on absent authority, terminal Decision and non-entry tactical signals", () => {
    expect(source).toContain('skipReason: "decision_v2_authority_missing"');
    expect(source).toContain('skipReason: "decision_v2_no_trade"');
    expect(source).toContain('skipReason: "decision_v2_no_entry_proposal"');
    expect(source).toContain('candidate.side === "buy"');
  });
});
