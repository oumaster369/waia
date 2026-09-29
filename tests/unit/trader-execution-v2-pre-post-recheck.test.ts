import { describe, expect, it } from "vitest";

import {
  evaluatePrePostRecheck,
  type PrePostRecheckFacts,
} from "@/lib/trader/execution/v2/pre-post-recheck-v2";

function clear(): PrePostRecheckFacts {
  return {
    killState: "CLEAR",
    enforcingSwitch: false,
    envelopeReason: null,
    executionMode: "paper",
    liveEnableState: null,
  };
}

describe("Execution V2 pre-POST recheck (DEE-1151 P1-1)", () => {
  it("allows a clear paper post", () => {
    expect(evaluatePrePostRecheck(clear())).toBeNull();
    expect(evaluatePrePostRecheck({ ...clear(), executionMode: "mock" })).toBeNull();
  });

  it("allows live only while org live enable is ENABLED", () => {
    expect(
      evaluatePrePostRecheck({ ...clear(), executionMode: "live", liveEnableState: "ENABLED" }),
    ).toBeNull();
  });

  it.each<[string, PrePostRecheckFacts, string]>([
    ["tripped kill state", { ...clear(), killState: "TRIPPED" }, "KILL_SWITCH_TRIPPED"],
    ["enforcing switch", { ...clear(), enforcingSwitch: true }, "KILL_SWITCH_TRIPPED"],
    [
      "stale envelope",
      { ...clear(), envelopeReason: "LIVE_CAPITAL_ENVELOPE_STALE" },
      "LIVE_CAPITAL_ENVELOPE_STALE",
    ],
    [
      "loss limit",
      { ...clear(), envelopeReason: "LIVE_CAPITAL_LOSS_LIMIT_EXCEEDED" },
      "LIVE_CAPITAL_LOSS_LIMIT_EXCEEDED",
    ],
    ["unknown mode", { ...clear(), executionMode: "unknown" }, "PRE_POST_RECHECK_FAILED"],
    [
      "live without a row",
      { ...clear(), executionMode: "live", liveEnableState: null },
      "LIVE_ENABLE_ABSENT",
    ],
    [
      "live disabled",
      { ...clear(), executionMode: "live", liveEnableState: "DISABLED" },
      "LIVE_ENABLE_NOT_ENABLED",
    ],
    [
      "live cooling off",
      { ...clear(), executionMode: "live", liveEnableState: "COOLING_OFF" },
      "LIVE_ENABLE_NOT_ENABLED",
    ],
  ])("refuses %s", (_label, facts, reason) => {
    expect(evaluatePrePostRecheck(facts)).toBe(reason);
  });
});
