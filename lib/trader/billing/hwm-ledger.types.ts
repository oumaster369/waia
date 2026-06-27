export const HWM_LEDGER_SCHEMA_VERSION = "waia.trader.hwm-ledger.v1" as const;

export type HwmLedgerSchemaVersion = typeof HWM_LEDGER_SCHEMA_VERSION;

export const hwmEntryTypes = ["BOOTSTRAP", "RATCHET_UP", "ROLLBACK"] as const;

export type HwmEntryType = (typeof hwmEntryTypes)[number];

/** Immutable valued-input payload digested for tamper detection (AT-E11 S3). */
export type HwmLedgerRecordPayload = {
  schemaVersion: HwmLedgerSchemaVersion;
  organizationId: string;
  exchangeAccountId: string;
  entryType: HwmEntryType;
  highWaterMark: string;
  previousHighWaterMark: string | null;
  sourcePeriodId: string | null;
  sourceInvoiceId: string | null;
  valuationSource: string;
  effectiveAt: Date;
  reason: string | null;
  recordContentDigest: string;
};

export type HwmLedgerRecordView = HwmLedgerRecordPayload & {
  id: string;
  createdAt: Date;
  updatedAt: Date;
};

export type HwmLedgerRecordDigestInput = {
  organizationId: string;
  exchangeAccountId: string;
  entryType: HwmEntryType;
  highWaterMark: string;
  previousHighWaterMark: string | null;
  sourcePeriodId: string | null;
  sourceInvoiceId: string | null;
  valuationSource: string;
  effectiveAt: Date;
  reason: string | null;
};
