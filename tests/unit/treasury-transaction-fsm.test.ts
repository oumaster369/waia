import { describe, expect, it } from "vitest";

import {
  IllegalTreasuryTransitionError,
  TREASURY_TX_STATUSES,
  allowedTreasuryTxTransitions,
  assertTreasuryTxTransitionAllowed,
  isTerminalTreasuryTxStatus,
  isTreasuryTxTransitionAllowed,
  type TreasuryTxStatus,
} from "@/lib/waia-core/treasury";

const ALLOWED: Array<[TreasuryTxStatus, TreasuryTxStatus]> = [
  ["DETECTED", "NEEDS_REVIEW"],
  ["DETECTED", "DUPLICATE"],
  ["DETECTED", "RECONCILIATION_REQUIRED"],
  ["DETECTED", "REJECTED"],
  ["MANUAL_DRAFT", "NEEDS_REVIEW"],
  ["MANUAL_DRAFT", "REJECTED"],
  ["NEEDS_REVIEW", "CLASSIFIED"],
  ["NEEDS_REVIEW", "REJECTED"],
  ["NEEDS_REVIEW", "DUPLICATE"],
  ["NEEDS_REVIEW", "RECONCILIATION_REQUIRED"],
  ["CLASSIFIED", "VERIFIED"],
  ["CLASSIFIED", "NEEDS_REVIEW"],
  ["CLASSIFIED", "REJECTED"],
  ["CLASSIFIED", "RECONCILIATION_REQUIRED"],
  ["VERIFIED", "RECONCILIATION_REQUIRED"],
  ["RECONCILIATION_REQUIRED", "NEEDS_REVIEW"],
  ["RECONCILIATION_REQUIRED", "REJECTED"],
  ["RECONCILIATION_REQUIRED", "DUPLICATE"],
  ["RECONCILIATION_REQUIRED", "VERIFIED"],
];

const ALLOWED_SET = new Set(ALLOWED.map(([from, to]) => `${from}->${to}`));

const FORBIDDEN: Array<[TreasuryTxStatus, TreasuryTxStatus]> = TREASURY_TX_STATUSES.flatMap(
  (from) =>
    TREASURY_TX_STATUSES.filter((to) => !ALLOWED_SET.has(`${from}->${to}`)).map(
      (to) => [from, to] as [TreasuryTxStatus, TreasuryTxStatus],
    ),
);

describe("treasury transaction FSM (DEE-606 WP-2)", () => {
  it.each(ALLOWED)("allows %s -> %s", (from, to) => {
    expect(isTreasuryTxTransitionAllowed(from, to)).toBe(true);
    expect(() => assertTreasuryTxTransitionAllowed("tx-1", from, to)).not.toThrow();
  });

  it.each(FORBIDDEN)("forbids %s -> %s", (from, to) => {
    expect(isTreasuryTxTransitionAllowed(from, to)).toBe(false);
    expect(() => assertTreasuryTxTransitionAllowed("tx-1", from, to)).toThrow(
      IllegalTreasuryTransitionError,
    );
  });

  it("treats REJECTED as terminal", () => {
    expect(isTerminalTreasuryTxStatus("REJECTED")).toBe(true);
    expect(allowedTreasuryTxTransitions("REJECTED")).toEqual([]);
  });

  it("treats DUPLICATE as terminal", () => {
    expect(isTerminalTreasuryTxStatus("DUPLICATE")).toBe(true);
    expect(allowedTreasuryTxTransitions("DUPLICATE")).toEqual([]);
  });

  it("allows VERIFIED to reopen only to RECONCILIATION_REQUIRED", () => {
    expect(allowedTreasuryTxTransitions("VERIFIED")).toEqual(["RECONCILIATION_REQUIRED"]);
  });

  it("returns from RECONCILIATION_REQUIRED only along the frozen graph", () => {
    expect(allowedTreasuryTxTransitions("RECONCILIATION_REQUIRED")).toEqual([
      "NEEDS_REVIEW",
      "REJECTED",
      "DUPLICATE",
      "VERIFIED",
    ]);
  });
});
