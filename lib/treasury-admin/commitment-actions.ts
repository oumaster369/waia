export type CommitmentStatus = "DRAFT" | "APPROVED" | "RELEASED" | "FULFILLED" | "CANCELLED";

export type CommitmentCommand = "approve" | "release" | "fulfill" | "cancel";

export type CommitmentAffordance = {
  command: CommitmentCommand;
  label: string;
  requiresReason: boolean;
  reducesFreeFunds: boolean;
};

const TRANSITIONS: Readonly<Record<CommitmentStatus, readonly CommitmentStatus[]>> = {
  DRAFT: ["APPROVED"],
  APPROVED: ["RELEASED", "CANCELLED"],
  RELEASED: ["FULFILLED", "CANCELLED"],
  FULFILLED: [],
  CANCELLED: [],
};

export function isActiveCommittedStatus(status: CommitmentStatus): boolean {
  return status === "APPROVED" || status === "RELEASED";
}

export function commitmentActionAffordances(status: CommitmentStatus): CommitmentAffordance[] {
  const actions: CommitmentAffordance[] = [];
  if (TRANSITIONS[status].includes("APPROVED")) {
    actions.push({
      command: "approve",
      label: "Approve",
      requiresReason: true,
      reducesFreeFunds: true,
    });
  }
  if (TRANSITIONS[status].includes("RELEASED")) {
    actions.push({
      command: "release",
      label: "Release",
      requiresReason: true,
      reducesFreeFunds: true,
    });
  }
  if (TRANSITIONS[status].includes("FULFILLED")) {
    actions.push({
      command: "fulfill",
      label: "Fulfill",
      requiresReason: true,
      reducesFreeFunds: false,
    });
  }
  if (TRANSITIONS[status].includes("CANCELLED")) {
    actions.push({
      command: "cancel",
      label: "Cancel",
      requiresReason: true,
      reducesFreeFunds: false,
    });
  }
  return actions;
}
