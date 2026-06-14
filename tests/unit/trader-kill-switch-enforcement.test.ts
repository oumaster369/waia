import { describe, expect, it } from "vitest";

import type { PlaceOrderInput } from "@/lib/trader/connectors/types";
import {
  buildKillSwitchAuditMetadata,
  mapEffectiveStateToDecision,
} from "@/lib/trader/risk/kill-switch-enforcement";
import type { EffectiveKillSwitchState } from "@/lib/trader/risk/kill-switch/types";
import { killSwitchReasonCodes } from "@/lib/trader/risk/reason-codes";

const EVALUATED_AT = "2026-06-14T12:00:00.000Z";

const ORDER: PlaceOrderInput = {
  clientOrderId: "coid-1",
  symbol: "BTC/USDT",
  side: "buy",
  type: "limit",
  price: "100",
  quantity: "0.1",
};

function effective(overrides: Partial<EffectiveKillSwitchState> = {}): EffectiveKillSwitchState {
  return {
    organizationId: "org-a",
    blocked: false,
    enforcementMode: null,
    bindingState: null,
    resolutionStatus: "ok",
    contributors: [],
    resolvedAt: EVALUATED_AT,
    ...overrides,
  };
}

describe("kill switch enforcement mapper (DEE-244)", () => {
  it("returns not enforced when blocked=false", () => {
    const result = mapEffectiveStateToDecision(effective(), ORDER, EVALUATED_AT);
    expect(result.enforced).toBe(false);
    expect(result.decision).toBeUndefined();
  });

  it("maps blocked REJECT to REJECT outcome", () => {
    const result = mapEffectiveStateToDecision(
      effective({ blocked: true, enforcementMode: "REJECT", bindingState: "ACTIVE" }),
      ORDER,
      EVALUATED_AT,
    );

    expect(result.enforced).toBe(true);
    expect(result.decision?.outcome).toBe("REJECT");
    expect(result.decision?.reasonCodes).toEqual([killSwitchReasonCodes.killSwitchActive]);
    expect(result.decision?.snapshot.checksApplied).toEqual([]);
  });

  it("maps blocked CLOSE_ONLY to CLOSE_ONLY outcome", () => {
    const result = mapEffectiveStateToDecision(
      effective({ blocked: true, enforcementMode: "CLOSE_ONLY", bindingState: "ACTIVE" }),
      ORDER,
      EVALUATED_AT,
    );

    expect(result.decision?.outcome).toBe("CLOSE_ONLY");
    expect(result.decision?.reasonCodes).toEqual([killSwitchReasonCodes.killSwitchActive]);
  });

  it("maps blocked STOP_ACCOUNT to STOP_ACCOUNT outcome", () => {
    const result = mapEffectiveStateToDecision(
      effective({ blocked: true, enforcementMode: "STOP_ACCOUNT", bindingState: "ACTIVE" }),
      ORDER,
      EVALUATED_AT,
    );

    expect(result.decision?.outcome).toBe("STOP_ACCOUNT");
    expect(result.decision?.reasonCodes).toEqual([killSwitchReasonCodes.killSwitchActive]);
  });

  it("maps fail_closed to STOP_ACCOUNT with unavailable reason code", () => {
    const result = mapEffectiveStateToDecision(
      effective({
        blocked: true,
        enforcementMode: "STOP_ACCOUNT",
        bindingState: "ACTIVE",
        resolutionStatus: "fail_closed",
      }),
      ORDER,
      EVALUATED_AT,
    );

    expect(result.enforced).toBe(true);
    expect(result.decision?.outcome).toBe("STOP_ACCOUNT");
    expect(result.decision?.reasonCodes).toEqual([killSwitchReasonCodes.killSwitchUnavailable]);
  });

  it("builds audit metadata with contributor identifiers", () => {
    const metadata = buildKillSwitchAuditMetadata(
      effective({
        blocked: true,
        enforcementMode: "REJECT",
        bindingState: "ACTIVE",
        contributors: [
          {
            killSwitchId: "ks-1",
            organizationId: "org-a",
            scopeType: "organization",
            scopeRef: null,
            switchType: "EMERGENCY_STOP",
            enforcementMode: "REJECT",
            state: "ACTIVE",
            stateVersion: 2,
            reason: "manual trip",
          },
        ],
      }),
    );

    expect(metadata).toMatchObject({
      blocked: true,
      enforcementMode: "REJECT",
      bindingState: "ACTIVE",
      resolutionStatus: "ok",
    });
    expect(metadata.contributors).toEqual([
      {
        killSwitchId: "ks-1",
        scopeType: "organization",
        scopeRef: null,
        switchType: "EMERGENCY_STOP",
        enforcementMode: "REJECT",
        state: "ACTIVE",
        stateVersion: 2,
      },
    ]);
  });
});
