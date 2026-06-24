import type {
  HwmLedgerRecordPayload,
  HwmLedgerRecordView,
} from "@/lib/trader/billing/hwm-ledger.types";
import { verifyHwmLedgerRecordDigest } from "@/lib/trader/billing/serialize-hwm-ledger";

type HwmLedgerRow = {
  id: string;
  organizationId: string;
  exchangeAccountId: string;
  entryType: HwmLedgerRecordPayload["entryType"];
  highWaterMark: string;
  previousHighWaterMark: string | null;
  sourcePeriodId: string | null;
  sourceInvoiceId: string | null;
  valuationSource: string;
  effectiveAt: Date;
  reason: string | null;
  schemaVersion: string;
  recordContentDigest: string;
  createdAt: Date;
  updatedAt: Date;
};

export function mapHwmLedgerRow(row: HwmLedgerRow): HwmLedgerRecordView {
  const view: HwmLedgerRecordView = {
    id: row.id,
    organizationId: row.organizationId,
    exchangeAccountId: row.exchangeAccountId,
    entryType: row.entryType,
    highWaterMark: row.highWaterMark,
    previousHighWaterMark: row.previousHighWaterMark,
    sourcePeriodId: row.sourcePeriodId,
    sourceInvoiceId: row.sourceInvoiceId,
    valuationSource: row.valuationSource,
    effectiveAt: row.effectiveAt,
    reason: row.reason,
    schemaVersion: row.schemaVersion as HwmLedgerRecordPayload["schemaVersion"],
    recordContentDigest: row.recordContentDigest,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  verifyHwmLedgerRecordDigest(view);
  return view;
}

export function hwmLedgerPayloadToInsertValues(
  id: string,
  organizationId: string,
  payload: HwmLedgerRecordPayload,
  createdAt: Date,
  updatedAt: Date,
) {
  return {
    id,
    organizationId,
    exchangeAccountId: payload.exchangeAccountId,
    entryType: payload.entryType,
    highWaterMark: payload.highWaterMark,
    previousHighWaterMark: payload.previousHighWaterMark,
    sourcePeriodId: payload.sourcePeriodId,
    sourceInvoiceId: payload.sourceInvoiceId,
    valuationSource: payload.valuationSource,
    effectiveAt: payload.effectiveAt,
    reason: payload.reason,
    schemaVersion: payload.schemaVersion,
    recordContentDigest: payload.recordContentDigest,
    createdAt,
    updatedAt,
  };
}
