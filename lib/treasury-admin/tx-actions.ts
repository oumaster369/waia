import type { AccountingStatus } from "@/lib/treasury-admin/publication";
import { canExposeDetailPublicAction } from "@/lib/treasury-admin/publication";

export type TreasuryTxCommand =
  | "submit_for_review"
  | "classify"
  | "verify"
  | "reject"
  | "confirm_duplicate"
  | "reopen_reconciliation"
  | "return_from_reconciliation"
  | "set_detail_publication"
  | "link_correction";

export type TxActionAffordance = {
  command: TreasuryTxCommand;
  label: string;
  impact: "medium" | "high";
};

const TRANSITIONS: Readonly<Record<AccountingStatus, readonly AccountingStatus[]>> = {
  DETECTED: ["NEEDS_REVIEW", "DUPLICATE", "RECONCILIATION_REQUIRED", "REJECTED"],
  MANUAL_DRAFT: ["NEEDS_REVIEW", "REJECTED"],
  NEEDS_REVIEW: ["CLASSIFIED", "REJECTED", "DUPLICATE", "RECONCILIATION_REQUIRED"],
  CLASSIFIED: ["VERIFIED", "NEEDS_REVIEW", "REJECTED", "RECONCILIATION_REQUIRED"],
  VERIFIED: ["RECONCILIATION_REQUIRED"],
  RECONCILIATION_REQUIRED: ["NEEDS_REVIEW", "REJECTED", "DUPLICATE", "VERIFIED"],
  REJECTED: [],
  DUPLICATE: [],
};

function canGo(from: AccountingStatus, to: AccountingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminalAccountingStatus(status: AccountingStatus): boolean {
  return status === "REJECTED" || status === "DUPLICATE";
}

export function canEditAccountingMeaning(status: AccountingStatus): boolean {
  return (
    status === "NEEDS_REVIEW" || status === "CLASSIFIED" || status === "RECONCILIATION_REQUIRED"
  );
}

export function isVerifiedFinancialLocked(status: AccountingStatus): boolean {
  return status === "VERIFIED" || isTerminalAccountingStatus(status);
}

/** Commands the operator may be offered. Impossible transitions are omitted. */
export function transactionActionAffordances(status: AccountingStatus): TxActionAffordance[] {
  const actions: TxActionAffordance[] = [];
  if (canGo(status, "NEEDS_REVIEW") && (status === "MANUAL_DRAFT" || status === "DETECTED")) {
    actions.push({ command: "submit_for_review", label: "Submit for review", impact: "medium" });
  }
  if (
    status === "NEEDS_REVIEW" ||
    status === "CLASSIFIED" ||
    status === "RECONCILIATION_REQUIRED"
  ) {
    actions.push({
      command: "classify",
      label:
        status === "NEEDS_REVIEW" ? "Classify accounting meaning" : "Update accounting meaning",
      impact: "medium",
    });
  }
  if (canGo(status, "VERIFIED") && status === "CLASSIFIED") {
    actions.push({ command: "verify", label: "Verify financial truth", impact: "high" });
  }
  if (canGo(status, "REJECTED")) {
    actions.push({ command: "reject", label: "Reject", impact: "medium" });
  }
  if (canGo(status, "DUPLICATE")) {
    actions.push({ command: "confirm_duplicate", label: "Confirm duplicate", impact: "medium" });
  }
  if (canGo(status, "RECONCILIATION_REQUIRED")) {
    actions.push({
      command: "reopen_reconciliation",
      label: "Reopen reconciliation",
      impact: "medium",
    });
  }
  if (status === "RECONCILIATION_REQUIRED") {
    actions.push({
      command: "return_from_reconciliation",
      label: "Return from reconciliation",
      impact: "high",
    });
  }
  if (canExposeDetailPublicAction(status)) {
    actions.push({
      command: "set_detail_publication",
      label: "Set public detail",
      impact: "high",
    });
  }
  if (status === "VERIFIED") {
    actions.push({ command: "link_correction", label: "Link correction", impact: "high" });
  }
  return actions;
}

export const TX_FSM_TRANSITIONS = TRANSITIONS;
