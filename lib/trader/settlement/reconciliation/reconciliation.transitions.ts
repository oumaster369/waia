import { ReconciliationIllegalTransitionError } from "@/lib/trader/settlement/reconciliation/reconciliation.errors";
import type { ReconciliationCaseStatus } from "@/lib/trader/settlement/reconciliation/reconciliation.types";

export const reconciliationCommands = {
  claim: "claim",
  release: "release",
  startReview: "startReview",
  proposeResolution: "proposeResolution",
  cancelProposal: "cancelProposal",
  executeResolution: "executeResolution",
  escalateExternal: "escalateExternal",
  reopenFromEscalation: "reopenFromEscalation",
  expireClaim: "expireClaim",
} as const;

export type ReconciliationCommand =
  (typeof reconciliationCommands)[keyof typeof reconciliationCommands];

const TRANSITIONS: Record<
  ReconciliationCaseStatus,
  Partial<Record<ReconciliationCommand, ReconciliationCaseStatus>>
> = {
  OPEN: {
    claim: "ASSIGNED",
  },
  ASSIGNED: {
    release: "OPEN",
    startReview: "UNDER_REVIEW",
    expireClaim: "OPEN",
  },
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
  ESCALATED: {
    reopenFromEscalation: "UNDER_REVIEW",
  },
  RESOLVED: {},
  CANCELLED: {},
};

export function resolveTransition(
  currentStatus: ReconciliationCaseStatus,
  command: ReconciliationCommand,
): ReconciliationCaseStatus | null {
  return TRANSITIONS[currentStatus][command] ?? null;
}

export function assertReconciliationTransitionAllowed(
  caseId: string,
  currentStatus: ReconciliationCaseStatus,
  command: ReconciliationCommand,
): ReconciliationCaseStatus {
  const next = resolveTransition(currentStatus, command);
  if (!next) {
    throw new ReconciliationIllegalTransitionError(caseId, currentStatus, command);
  }
  return next;
}

export function isTerminalReconciliationStatus(status: ReconciliationCaseStatus): boolean {
  return status === "RESOLVED";
}

export function isForbiddenReconciliationStatus(status: ReconciliationCaseStatus): boolean {
  return status === "CANCELLED";
}

export function listAllowedCommands(status: ReconciliationCaseStatus): ReconciliationCommand[] {
  return Object.entries(TRANSITIONS[status])
    .filter(([, next]) => next !== undefined)
    .map(([command]) => command as ReconciliationCommand);
}
