/** AI-TRADER audit action constants (AT-E1 scaffolding). */
export const traderAuditActions = {
  orgProfileCreated: "trader.org_profile.created",
  credentialCreated: "trader.credential.created",
  credentialRotated: "trader.credential.rotated",
  credentialRevoked: "trader.credential.revoked",
  balanceSnapshotCreated: "trader.balance_snapshot.created",
  reportingPeriodOpened: "trader.reporting_period.opened",
  reportingPeriodClosed: "trader.reporting_period.closed",
  hwmBootstrapped: "trader.hwm.bootstrapped",
  hwmRatcheted: "trader.hwm.ratcheted",
  hwmRolledBack: "trader.hwm.rolled_back",
  invoiceDraftGenerated: "trader.invoice.draft_generated",
  invoiceIssuanceApproved: "trader.invoice.issuance_approved",
  invoiceIssuanceCancelled: "trader.invoice.issuance_cancelled",
  invoiceIssued: "trader.invoice.issued",
  invoicePaid: "trader.invoice.paid",
  settlementApplied: "trader.settlement.applied",
  settlementException: "trader.settlement.exception",
  settlementReconciliationCaseOpened: "trader.settlement_reconciliation.case_opened",
  settlementReconciliationCaseClaimed: "trader.settlement_reconciliation.case_claimed",
  settlementReconciliationCaseReleased: "trader.settlement_reconciliation.case_released",
  settlementReconciliationReviewStarted: "trader.settlement_reconciliation.review_started",
  settlementReconciliationResolutionProposed:
    "trader.settlement_reconciliation.resolution_proposed",
  settlementReconciliationProposalCancelled: "trader.settlement_reconciliation.proposal_cancelled",
  settlementReconciliationResolutionExecuted:
    "trader.settlement_reconciliation.resolution_executed",
  settlementReconciliationManualApplied: "trader.settlement_reconciliation.manual_applied",
  settlementReconciliationWaived: "trader.settlement_reconciliation.waived",
  settlementReconciliationClosedNoAction: "trader.settlement_reconciliation.closed_no_action",
  settlementReconciliationClosedDuplicate: "trader.settlement_reconciliation.closed_duplicate",
  settlementReconciliationEscalated: "trader.settlement_reconciliation.escalated",
  settlementReconciliationReopened: "trader.settlement_reconciliation.reopened",
  settlementReconciliationClaimExpired: "trader.settlement_reconciliation.claim_expired",
  accountReactivated: "trader.account.reactivated",
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
  miEvidenceRecorded: "trader.mi_evidence.recorded",
  miTrialRegistered: "trader.mi_trial.registered",
  miTrialIntegrityInvalidated: "trader.mi_trial_integrity.invalidated",
  miConfidenceJudgmentRecorded: "trader.mi_confidence_judgment.recorded",
} as const;

export type TraderAuditAction = (typeof traderAuditActions)[keyof typeof traderAuditActions];

/** AI-TRADER audit entity type constants. */
export const traderEntityTypes = {
  orgProfile: "trader.org_profile",
  exchangeCredential: "trader.exchange_credential",
  balanceSnapshot: "trader.balance_snapshot",
  reportingPeriod: "trader.reporting_period",
  hwmLedger: "trader.hwm_ledger",
  invoice: "trader.invoice",
  settlement: "trader.settlement",
  settlementReconciliationCase: "trader.settlement_reconciliation_case",
  accountStatus: "trader.account_status",
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
  miEvidence: "trader.mi_evidence",
  miTrial: "trader.mi_trial",
  miTrialIntegrity: "trader.mi_trial_integrity",
  miConfidenceJudgment: "trader.mi_confidence_judgment",
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
