import { describe, expect, it } from "vitest";

import {
  OPERATOR_ALLOWED_ACTIONS,
  OPERATOR_FORBIDDEN_ACTIONS,
  OperatorAuthorityError,
  assertOperatorActionAllowed,
  isOperatorActionAllowed,
} from "@/lib/trader/operator/operator-authority";

describe("operator authority (ADR-0019)", () => {
  it("allows recommend-only actions", () => {
    for (const action of OPERATOR_ALLOWED_ACTIONS) {
      expect(isOperatorActionAllowed(action)).toBe(true);
      expect(() => assertOperatorActionAllowed(action)).not.toThrow();
    }
  });

  it("rejects forbidden capital/governance actions", () => {
    for (const action of OPERATOR_FORBIDDEN_ACTIONS) {
      expect(isOperatorActionAllowed(action)).toBe(false);
      expect(() => assertOperatorActionAllowed(action)).toThrow(OperatorAuthorityError);
      try {
        assertOperatorActionAllowed(action);
      } catch (err) {
        expect(err).toMatchObject({ code: "OPERATOR_ACTION_FORBIDDEN" });
      }
    }
  });

  it("rejects unknown actions fail-closed", () => {
    expect(() => assertOperatorActionAllowed("totally_unknown_action")).toThrow(
      OperatorAuthorityError,
    );
    try {
      assertOperatorActionAllowed("totally_unknown_action");
    } catch (err) {
      expect(err).toMatchObject({ code: "OPERATOR_ACTION_UNKNOWN" });
    }
  });

  it("never allows promotion or live trading actions", () => {
    expect(() => assertOperatorActionAllowed("promote_strategy")).toThrow(OperatorAuthorityError);
    expect(() => assertOperatorActionAllowed("live_enable_trading")).toThrow(
      OperatorAuthorityError,
    );
    expect(() => assertOperatorActionAllowed("place_order")).toThrow(OperatorAuthorityError);
  });
});
