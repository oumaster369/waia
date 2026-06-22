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
  promotionRequested: "trader.strategy_promotion.requested",
  promotionConfirmed: "trader.strategy_promotion.confirmed",
  promotionEffective: "trader.strategy_promotion.effective",
  promotionCancelled: "trader.strategy_promotion.cancelled",
  promotionDemoted: "trader.strategy_promotion.demoted",
  miSourceCreated: "trader.mi_source.created",
  miSourceStatusChanged: "trader.mi_source.status_changed",
  miSourceTrustAppended: "trader.mi_source_trust.appended",
  miObservationRecorded: "trader.mi_observation.recorded",
  miObservationRevised: "trader.mi_observation.revised",
  miMeasurementRegistered: "trader.mi_measurement.registered",
  miMeasurementRevised: "trader.mi_measurement.revised",
  miPatternRegistered: "trader.mi_pattern.registered",
  miPatternRevised: "trader.mi_pattern.revised",
  miPatternArchived: "trader.mi_pattern.archived",
  miPatternReactivated: "trader.mi_pattern.reactivated",
  miHypothesisRegistered: "trader.mi_hypothesis.registered",
  miHypothesisRevised: "trader.mi_hypothesis.revised",
  miHypothesisLifecycleTransitioned: "trader.mi_hypothesis.lifecycle_transitioned",
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
  strategyPromotion: "trader.strategy_promotion",
  miSource: "trader.mi_source",
  miSourceTrust: "trader.mi_source_trust",
  miObservation: "trader.mi_observation",
  miMeasurement: "trader.mi_measurement",
  miPattern: "trader.mi_pattern",
  miPatternLifecycle: "trader.mi_pattern_lifecycle",
  miHypothesis: "trader.mi_hypothesis",
  miHypothesisLifecycle: "trader.mi_hypothesis_lifecycle",
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
