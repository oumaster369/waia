import { describe, expect, it } from "vitest";

import {
  evaluatePrePostRecheck,
  type PrePostRecheckFacts,
} from "@/lib/trader/execution/v2/pre-post-recheck-v2";
import type { ExecutionV2LiveGateFacts } from "@/lib/trader/execution/v2/live-gates";
import { buildHtxPermissionMetadata } from "@/lib/trader/security/htx-credential-types";

const ORG = "00000000-0000-4000-8000-000000115104";

function tradeMetadata(scopes: readonly string[] = ["read", "trade"]): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(
      buildHtxPermissionMetadata({
        exchangeAccountId: "acct-1",
        scopes,
      }),
    ),
  ) as Record<string, unknown>;
}

function admittedGates(): ExecutionV2LiveGateFacts {
  return {
    executionMode: "live",
    organizationId: ORG,
    org0OrganizationId: ORG,
    liveEnable: { state: "ENABLED", maxNotionalCap: "25" },
    strategyId: "strategy-1",
    strategyVersion: "v1",
    promotion: { strategyId: "strategy-1", strategyVersion: "v1", state: "EFFECTIVE" },
    credentialId: "cred-1",
    credential: {
      status: "active",
      venue: "htx",
      exchangeAccountId: "acct-1",
      permissionMetadata: tradeMetadata(),
    },
    requestedNotional: "25",
  };
}

function clear(): PrePostRecheckFacts {
  return {
    killState: "CLEAR",
    enforcingSwitch: false,
    envelopeReason: null,
    executionMode: "paper",
    liveGates: null,
  };
}

function live(gates: ExecutionV2LiveGateFacts | null = admittedGates()): PrePostRecheckFacts {
  return { ...clear(), executionMode: "live", liveGates: gates };
}

describe("Execution V2 pre-POST recheck (DEE-1151 P1-1)", () => {
  it("allows a clear paper post without live gates", () => {
    expect(evaluatePrePostRecheck(clear())).toBeNull();
    expect(evaluatePrePostRecheck({ ...clear(), executionMode: "mock" })).toBeNull();
  });

  it("allows live only when Org0, EFFECTIVE promotion, and trade scope all pass", () => {
    expect(evaluatePrePostRecheck(live())).toBeNull();
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
    ["live without gate facts", live(null), "PRE_POST_RECHECK_FAILED"],
    ["unset org0", live({ ...admittedGates(), org0OrganizationId: null }), "ORG0_ALLOWLIST_UNSET"],
    [
      "org outside org0",
      live({ ...admittedGates(), org0OrganizationId: "other-org" }),
      "ORG0_NOT_ALLOWLISTED",
    ],
    [
      "live disabled",
      live({ ...admittedGates(), liveEnable: { state: "DISABLED", maxNotionalCap: "25" } }),
      "LIVE_ENABLE_NOT_ENABLED",
    ],
    [
      "live cooling off",
      live({ ...admittedGates(), liveEnable: { state: "COOLING_OFF", maxNotionalCap: "25" } }),
      "LIVE_ENABLE_NOT_ENABLED",
    ],
    ["live enable absent", live({ ...admittedGates(), liveEnable: null }), "LIVE_ENABLE_ABSENT"],
    [
      "promotion not effective",
      live({
        ...admittedGates(),
        promotion: { strategyId: "strategy-1", strategyVersion: "v1", state: "DRAFT" },
      }),
      "PROMOTION_NOT_EFFECTIVE",
    ],
    ["promotion absent", live({ ...admittedGates(), promotion: null }), "PROMOTION_NOT_EFFECTIVE"],
    [
      "promotion version mismatch",
      live({
        ...admittedGates(),
        promotion: { strategyId: "strategy-1", strategyVersion: "v0", state: "EFFECTIVE" },
      }),
      "PROMOTION_VERSION_MISMATCH",
    ],
    [
      "credential without trade scope",
      live({
        ...admittedGates(),
        credential: {
          status: "active",
          venue: "htx",
          exchangeAccountId: "acct-1",
          permissionMetadata: tradeMetadata(["read"]),
        },
      }),
      "CREDENTIAL_NOT_TRADE_SCOPED",
    ],
  ])("refuses %s", (_label, facts, reason) => {
    expect(evaluatePrePostRecheck(facts)).toBe(reason);
  });
});
