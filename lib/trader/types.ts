/** AI-TRADER audit action constants (AT-E1 scaffolding). */
export const traderAuditActions = {
  orgProfileCreated: "trader.org_profile.created",
  credentialCreated: "trader.credential.created",
  credentialRotated: "trader.credential.rotated",
  credentialRevoked: "trader.credential.revoked",
  balanceSnapshotCreated: "trader.balance_snapshot.created",
  riskLimitsCreated: "trader.risk_limits.created",
  riskLimitsUpdated: "trader.risk_limits.updated",
  riskDecisionCreated: "trader.risk_decision.created",
  killSwitchTripped: "trader.kill_switch.tripped",
  killSwitchEscalated: "trader.kill_switch.escalated",
  killSwitchClearingStarted: "trader.kill_switch.clearing_started",
  killSwitchClearCancelled: "trader.kill_switch.clear_cancelled",
  killSwitchCleared: "trader.kill_switch.cleared",
  orderSubmissionStarted: "trader.order.submission_started",
  orderSubmitBlocked: "trader.order.submit_blocked",
  orderConnectorUncertain: "trader.order.connector_uncertain",
  orderConnectorRejected: "trader.order.connector_rejected",
  orderConnectorFilled: "trader.order.connector_filled",
  orderReconciliationMismatch: "trader.order.reconciliation_mismatch",
  orderReconciliationRequired: "trader.order.reconciliation_required",
  orderReconciliationUnknownPosition: "trader.order.reconciliation_unknown_position",
  orderReconciliationTerminalDrift: "trader.order.reconciliation_terminal_drift",
} as const;

export type TraderAuditAction = (typeof traderAuditActions)[keyof typeof traderAuditActions];

/** AI-TRADER audit entity type constants. */
export const traderEntityTypes = {
  orgProfile: "trader.org_profile",
  exchangeCredential: "trader.exchange_credential",
  balanceSnapshot: "trader.balance_snapshot",
  riskLimits: "trader.risk_limits",
  riskDecision: "trader.risk_decision",
  killSwitch: "trader.kill_switch",
  order: "trader.order",
} as const;

export type TraderEntityType = (typeof traderEntityTypes)[keyof typeof traderEntityTypes];

export type TraderAuditInput = {
  actorType: "user" | "admin" | "agent" | "service" | "system";
  actorId?: string | null;
  action: TraderAuditAction;
  entityType: TraderEntityType;
  entityId?: string | null;
  organizationId: string;
  metadata?: Record<string, unknown>;
};

export type EnsureTraderOrgProfileInput = {
  organizationId: string;
  actorType?: TraderAuditInput["actorType"];
  actorId?: string | null;
};

export type EnsureTraderOrgProfileResult = {
  profileId: string;
  created: boolean;
};
