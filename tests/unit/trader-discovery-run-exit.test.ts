import { describe, expect, it } from "vitest";

import { resolveDiscoveryRunExitCode } from "../../scripts/trader/discovery-run";

describe("trader:discovery:run exit codes", () => {
  it("exits non-zero on incomplete research-v2 admission", () => {
    expect(
      resolveDiscoveryRunExitCode({
        enabled: true,
        barsCount: 10,
        closedTradeCount: 4,
        result: {
          skipped: true,
          reason: "research_v2_admission_incomplete",
          status: "FAIL_CLOSED",
        },
      }),
    ).toBe(1);
  });

  it("exits non-zero on empty bars or empty closed trades when the run is enabled", () => {
    expect(
      resolveDiscoveryRunExitCode({
        enabled: true,
        barsCount: 0,
        closedTradeCount: 2,
        result: { skipped: false, status: "HUMAN_PROPOSAL_PENDING" },
      }),
    ).toBe(1);
    expect(
      resolveDiscoveryRunExitCode({
        enabled: true,
        barsCount: 3,
        closedTradeCount: 0,
        result: { skipped: false },
      }),
    ).toBe(1);
    expect(
      resolveDiscoveryRunExitCode({
        enabled: true,
        barsCount: 0,
        closedTradeCount: 0,
        result: { skipped: true, reason: "research_v2_outcomes_required" },
      }),
    ).toBe(1);
  });

  it("keeps a disabled empty run at exit zero", () => {
    expect(
      resolveDiscoveryRunExitCode({
        enabled: false,
        barsCount: 0,
        closedTradeCount: 0,
        result: { skipped: true, reason: "discovery_run_disabled" },
      }),
    ).toBe(0);
  });
});
