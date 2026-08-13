export const treasuryAuditActions = {
  transactionManualCreate: "treasury.transaction.manual_create",
  transactionWatcherCreate: "treasury.transaction.watcher_create",
  transactionClassify: "treasury.transaction.classify",
  transactionStatusTransition: "treasury.transaction.status_transition",
  transactionVerify: "treasury.transaction.verify",
  transactionReject: "treasury.transaction.reject",
  transactionDuplicate: "treasury.transaction.duplicate",
  transactionReconciliationReopen: "treasury.transaction.reconciliation_reopen",
  transactionCorrectionLink: "treasury.transaction.correction_link",
  transactionDetailPublication: "treasury.transaction.detail_publication",
  commitmentCreate: "treasury.commitment.create",
  commitmentApprove: "treasury.commitment.approve",
  commitmentRelease: "treasury.commitment.release",
  commitmentFulfill: "treasury.commitment.fulfill",
  commitmentCancel: "treasury.commitment.cancel",
  inceptionCreate: "treasury.inception.create",
  inceptionActivate: "treasury.inception.activate",
  inceptionSupersede: "treasury.inception.supersede",
} as const;

export type TreasuryAuditAction = (typeof treasuryAuditActions)[keyof typeof treasuryAuditActions];

export const treasuryEntityTypes = {
  transaction: "treasury_transaction",
  commitment: "treasury_commitment",
  inception: "treasury_ledger_inception",
  revision: "treasury_transaction_revision",
  commitmentRevision: "treasury_commitment_revision",
} as const;
