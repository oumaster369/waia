import { createHash } from "node:crypto";

import { HwmLedgerDigestMismatchError } from "@/lib/trader/billing/hwm-ledger.errors";
import {
  HWM_LEDGER_SCHEMA_VERSION,
  type HwmLedgerRecordDigestInput,
  type HwmLedgerRecordPayload,
} from "@/lib/trader/billing/hwm-ledger.types";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";

export type SerializedHwmLedgerDigestInput = {
  schemaVersion: typeof HWM_LEDGER_SCHEMA_VERSION;
  organizationId: string;
  exchangeAccountId: string;
  entryType: HwmLedgerRecordDigestInput["entryType"];
  highWaterMark: string;
  previousHighWaterMark: string | null;
  sourcePeriodId: string | null;
  sourceInvoiceId: string | null;
  valuationSource: string;
  effectiveAt: string;
  reason: string | null;
};

function toIsoTimestamp(value: Date): string {
  return value.toISOString();
}

export function serializeHwmLedgerDigestInput(
  input: HwmLedgerRecordDigestInput,
): SerializedHwmLedgerDigestInput {
  return {
    schemaVersion: HWM_LEDGER_SCHEMA_VERSION,
    organizationId: input.organizationId,
    exchangeAccountId: input.exchangeAccountId,
    entryType: input.entryType,
    highWaterMark: input.highWaterMark,
    previousHighWaterMark: input.previousHighWaterMark,
    sourcePeriodId: input.sourcePeriodId,
    sourceInvoiceId: input.sourceInvoiceId,
    valuationSource: input.valuationSource,
    effectiveAt: toIsoTimestamp(input.effectiveAt),
    reason: input.reason,
  };
}

export function computeHwmLedgerRecordDigest(input: HwmLedgerRecordDigestInput): string {
  const canonical = serializeHwmLedgerDigestInput(input);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function buildHwmLedgerRecordPayload(
  input: HwmLedgerRecordDigestInput,
): HwmLedgerRecordPayload {
  const recordContentDigest = computeHwmLedgerRecordDigest(input);
  return {
    ...input,
    schemaVersion: HWM_LEDGER_SCHEMA_VERSION,
    recordContentDigest,
  };
}

export function verifyHwmLedgerRecordDigest(payload: HwmLedgerRecordPayload): void {
  const { recordContentDigest, schemaVersion: _schemaVersion, ...digestInput } = payload;
  const expected = computeHwmLedgerRecordDigest(digestInput);
  if (expected !== recordContentDigest) {
    throw new HwmLedgerDigestMismatchError();
  }
}
