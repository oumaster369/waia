import { describe, expect, it } from "vitest";

import {
  assertReconciliationTransitionAllowed,
  isForbiddenReconciliationStatus,
  isTerminalReconciliationStatus,
  listAllowedCommands,
  reconciliationCommands,
  resolveTransition,
  type ReconciliationCommand,
} from "@/lib/trader/settlement/reconciliation/reconciliation.transitions";
import { ReconciliationIllegalTransitionError } from "@/lib/trader/settlement/reconciliation/reconciliation.errors";
import type { ReconciliationCaseStatus } from "@/lib/trader/settlement/reconciliation/reconciliation.types";

const ALL_STATUSES: ReconciliationCaseStatus[] = [
  "OPEN",
  "ASSIGNED",
  "UNDER_REVIEW",
  "DECISION_PENDING",
  "ESCALATED",
  "RESOLVED",
  "CANCELLED",
];

const ALL_COMMANDS: ReconciliationCommand[] = Object.values(reconciliationCommands);

const EXPECTED: Partial<
  Record<ReconciliationCaseStatus, Partial<Record<ReconciliationCommand, ReconciliationCaseStatus>>>
> = {
  OPEN: { claim: "ASSIGNED" },
  ASSIGNED: { release: "OPEN", startReview: "UNDER_REVIEW", expireClaim: "OPEN" },
  UNDER_REVIEW: {
    release: "OPEN",
    proposeResolution: "DECISION_PENDING",
    escalateExternal: "ESCALATED",
    expireClaim: "OPEN",
  },
  DECISION_PENDING: {
    cancelProposal: "UNDER_REVIEW",
    executeResolution: "RESOLVED",
    escalateExternal: "ESCALATED",
  },
  ESCALATED: { reopenFromEscalation: "UNDER_REVIEW" },
  RESOLVED: {},
  CANCELLED: {},
};

describe("reconciliation.transitions", () => {
  it.each(
    ALL_STATUSES.flatMap((status) =>
      ALL_COMMANDS.map((command) => ({
        status,
        command,
        expected: EXPECTED[status]?.[command] ?? null,
      })),
    ),
  )("$status + $command", ({ status, command, expected }) => {
    if (expected) {
      expect(resolveTransition(status, command)).toBe(expected);
      expect(assertReconciliationTransitionAllowed("case-1", status, command)).toBe(expected);
    } else {
      expect(resolveTransition(status, command)).toBeNull();
      expect(() => assertReconciliationTransitionAllowed("case-1", status, command)).toThrow(
        ReconciliationIllegalTransitionError,
      );
    }
  });

  it("forbids RESOLVED transitions", () => {
    expect(listAllowedCommands("RESOLVED")).toEqual([]);
    expect(isTerminalReconciliationStatus("RESOLVED")).toBe(true);
  });

  it("treats CANCELLED as forbidden", () => {
    expect(isForbiddenReconciliationStatus("CANCELLED")).toBe(true);
    expect(listAllowedCommands("CANCELLED")).toEqual([]);
  });
});
