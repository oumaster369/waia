export const INVOICE_SCHEMA_VERSION = "waia.trader.invoice.v1" as const;

export type InvoiceSchemaVersion = typeof INVOICE_SCHEMA_VERSION;

export const invoiceStatuses = ["DRAFT"] as const;

export type InvoiceStatus = (typeof invoiceStatuses)[number];

/** Fixed fee denomination for AT-E11 S5 (USDT payment rail is out of scope). */
export const INVOICE_CURRENCY = "USD" as const;

/** Immutable valued-input payload digested for tamper detection (AT-E11 S5). */
export type InvoiceRecordPayload = {
  schemaVersion: InvoiceSchemaVersion;
  organizationId: string;
  exchangeAccountId: string;
  reportingPeriodId: string;
  feeArtifactDigest: string;
  status: InvoiceStatus;
  currency: typeof INVOICE_CURRENCY;
  periodRealizedStrategyProfit: string;
  cumulativeRealizedStrategyProfit: string;
  previousHighWaterMark: string;
  newProfitAboveHwm: string;
  feeRate: string;
  performanceFee: string;
  proposedNewHighWaterMark: string;
  billable: boolean;
  unrealizedPnl: string | null;
  realizedFillFinality: boolean;
  startingEquity: string;
  endingEquity: string;
  netDeposits: string;
  netWithdrawals: string;
  periodStart: Date;
  periodEnd: Date;
  valuationSource: string;
  feeComputedAt: Date;
  recordContentDigest: string;
};

export type InvoiceRecordView = InvoiceRecordPayload & {
  id: string;
  createdAt: Date;
  updatedAt: Date;
};

export type InvoiceRecordDigestInput = {
  organizationId: string;
  exchangeAccountId: string;
  reportingPeriodId: string;
  feeArtifactDigest: string;
  status: InvoiceStatus;
  currency: typeof INVOICE_CURRENCY;
  periodRealizedStrategyProfit: string;
  cumulativeRealizedStrategyProfit: string;
  previousHighWaterMark: string;
  newProfitAboveHwm: string;
  feeRate: string;
  performanceFee: string;
  proposedNewHighWaterMark: string;
  billable: boolean;
  unrealizedPnl: string | null;
  realizedFillFinality: boolean;
  startingEquity: string;
  endingEquity: string;
  netDeposits: string;
  netWithdrawals: string;
  periodStart: Date;
  periodEnd: Date;
  valuationSource: string;
  feeComputedAt: Date;
};

export type GenerateDraftInvoiceInput = {
  periodId: string;
  realizedFillFinality?: boolean;
  computedAt?: Date;
};
