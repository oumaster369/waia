export type AttentionInput = {
  reconciliationRequiredOrderIds: string[];
  sentWithoutReportOrderIds: string[];
  runtimeHalted: boolean;
  killed: boolean;
  lotsMissingGuardian: string[];
  divergentAccountIds: string[];
  openReconciliationCaseIds: string[];
  staleActiveAccountIds: string[];
  failedJobStreak: number;
  recentFatalIncidents: number;
  ownershipConflicts: string[];
  overdueInvoiceIds: string[];
  settlementExceptions: string[];
  blockedPeriodIds: string[];
  staleQuietAccountIds: string[];
  promotionProposalIds: string[];
  noTradeCount: number;
};

export type AttentionItem = {
  severity: "critical" | "high" | "medium" | "low";
  reason: string;
  entityIds: string[];
  href: string;
};

export function buildAttention(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const unknown = [...input.reconciliationRequiredOrderIds, ...input.sentWithoutReportOrderIds];
  if (unknown.length > 0) {
    items.push({
      severity: "critical",
      reason: "UNKNOWN_ORDER_OUTCOME",
      entityIds: unknown,
      href: "/admin/orders",
    });
  }
  if (input.runtimeHalted || input.killed) {
    items.push({
      severity: "critical",
      reason: input.killed ? "POSTURE_KILLED" : "RUNTIME_HALT",
      entityIds: [],
      href: "/admin/runtime-authority",
    });
  }
  if (input.lotsMissingGuardian.length > 0) {
    items.push({
      severity: "critical",
      reason: "GUARDIAN_STALE",
      entityIds: input.lotsMissingGuardian,
      href: "/admin/positions",
    });
  }
  const money = [...input.divergentAccountIds, ...input.openReconciliationCaseIds];
  if (money.length > 0) {
    items.push({
      severity: "high",
      reason: "MONEY_DIVERGENCE",
      entityIds: money,
      href: "/admin/accounts",
    });
  }
  if (input.staleActiveAccountIds.length > 0) {
    items.push({
      severity: "high",
      reason: "STALE_ACTIVE_OBSERVATION",
      entityIds: input.staleActiveAccountIds,
      href: "/admin/accounts",
    });
  }
  if (input.failedJobStreak >= 3 || input.recentFatalIncidents > 0) {
    items.push({
      severity: "high",
      reason: "SERVICE_FAILURE",
      entityIds: [],
      href: "/admin/system",
    });
  }
  if (input.ownershipConflicts.length > 0) {
    items.push({
      severity: "high",
      reason: "OWNERSHIP_CONFLICT",
      entityIds: input.ownershipConflicts,
      href: "/admin/accounts",
    });
  }
  if (input.overdueInvoiceIds.length > 0 || input.settlementExceptions.length > 0) {
    items.push({
      severity: "medium",
      reason: "BILLING_ATTENTION",
      entityIds: [...input.overdueInvoiceIds, ...input.settlementExceptions],
      href: "/admin/billing",
    });
  }
  if (input.blockedPeriodIds.length > 0) {
    items.push({
      severity: "medium",
      reason: "PERIOD_BLOCKED",
      entityIds: input.blockedPeriodIds,
      href: "/admin/billing",
    });
  }
  if (input.staleQuietAccountIds.length > 0) {
    items.push({
      severity: "medium",
      reason: "STALE_QUIET_OBSERVATION",
      entityIds: input.staleQuietAccountIds,
      href: "/admin/accounts",
    });
  }
  if (input.promotionProposalIds.length > 0) {
    items.push({
      severity: "low",
      reason: "PROMOTION_REVIEW",
      entityIds: input.promotionProposalIds,
      href: "/admin/strategy-promotions",
    });
  }
  if (input.noTradeCount < 0) return [];
  return items;
}
