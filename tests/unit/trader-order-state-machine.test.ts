import { describe, expect, it } from "vitest";

import {
  assertTransition,
  isLegalTransition,
  isTerminal,
  ORDER_TRANSITIONS,
  TERMINAL_ORDER_STATES,
} from "@/lib/trader/execution/order-state-machine";
import {
  IllegalOrderTransitionError,
  orderStateEnum,
  type OrderState,
} from "@/lib/trader/execution/types";

describe("order state machine (DEE-247)", () => {
  it("defines transitions for all 12 canonical states", () => {
    for (const state of orderStateEnum) {
      expect(ORDER_TRANSITIONS[state]).toBeDefined();
    }
  });

  it("accepts every legal transition edge", () => {
    for (const [from, targets] of Object.entries(ORDER_TRANSITIONS) as [
      OrderState,
      OrderState[],
    ][]) {
      for (const to of targets) {
        expect(isLegalTransition(from, to)).toBe(true);
        expect(() => assertTransition(from, to)).not.toThrow();
      }
    }
  });

  it("rejects skipping risk gate transitions", () => {
    const illegal: [OrderState, OrderState][] = [
      ["CREATED", "SENT_TO_EXCHANGE"],
      ["CREATED", "ACCEPTED"],
      ["CREATED", "FILLED"],
      ["RISK_APPROVED", "ACCEPTED"],
      ["RISK_APPROVED", "FILLED"],
    ];

    for (const [from, to] of illegal) {
      expect(isLegalTransition(from, to)).toBe(false);
      expect(() => assertTransition(from, to)).toThrow(IllegalOrderTransitionError);
    }
  });

  it("rejects backward transitions", () => {
    const illegal: [OrderState, OrderState][] = [
      ["ACCEPTED", "CREATED"],
      ["SENT_TO_EXCHANGE", "RISK_APPROVED"],
      ["CANCELLED", "CANCEL_REQUESTED"],
    ];

    for (const [from, to] of illegal) {
      expect(isLegalTransition(from, to)).toBe(false);
    }
  });

  it("rejects transitions from terminal states", () => {
    for (const terminal of TERMINAL_ORDER_STATES) {
      expect(isTerminal(terminal)).toBe(true);
      for (const to of orderStateEnum) {
        if (to === terminal) continue;
        expect(isLegalTransition(terminal, to)).toBe(false);
      }
    }
  });

  it("marks non-terminal states correctly", () => {
    const nonTerminal: OrderState[] = [
      "CREATED",
      "RISK_APPROVED",
      "SENT_TO_EXCHANGE",
      "ACCEPTED",
      "PARTIALLY_FILLED",
      "CANCEL_REQUESTED",
      "RECONCILIATION_REQUIRED",
    ];

    for (const state of nonTerminal) {
      expect(isTerminal(state)).toBe(false);
      expect(ORDER_TRANSITIONS[state].length).toBeGreaterThan(0);
    }
  });

  it("allows reconciliation recovery transitions", () => {
    const targets: OrderState[] = [
      "ACCEPTED",
      "PARTIALLY_FILLED",
      "FILLED",
      "CANCELLED",
      "REJECTED",
      "EXPIRED",
      "FAILED",
    ];

    for (const to of targets) {
      expect(isLegalTransition("RECONCILIATION_REQUIRED", to)).toBe(true);
    }
  });

  it("throws IllegalOrderTransitionError with from/to states", () => {
    try {
      assertTransition("FILLED", "ACCEPTED");
      expect.fail("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalOrderTransitionError);
      const err = error as IllegalOrderTransitionError;
      expect(err.fromState).toBe("FILLED");
      expect(err.toState).toBe("ACCEPTED");
    }
  });
});
