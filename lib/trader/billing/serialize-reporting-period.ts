import { createHash } from "node:crypto";

import { ReportingPeriodDigestMismatchError } from "@/lib/trader/billing/reporting-period.errors";
import {
  REPORTING_PERIOD_SCHEMA_VERSION,
  type ReportingPeriodRecordDigestInput,
  type ReportingPeriodRecordPayload,
} from "@/lib/trader/billing/reporting-period.types";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";

export type SerializedReportingPeriodDigestInput = {
  schemaVersion: typeof REPORTING_PERIOD_SCHEMA_VERSION;
  organizationId: string;
  exchangeAccountId: string;
  periodStart: string;
  periodEnd: string | null;
  startingEquity: string;
  endingEquity: string | null;
  openPositionsSnapshotRef: string;
  realizedPnl: string | null;
  unrealizedPnl: string | null;
  netDeposits: string;
  netWithdrawals: string;
  valuationSource: string;
  startingSnapshotAt: string;
  endingSnapshotAt: string | null;
  status: ReportingPeriodRecordDigestInput["status"];
};

function toIsoTimestamp(value: Date): string {
  return value.toISOString();
}

export function serializeReportingPeriodDigestInput(
  input: ReportingPeriodRecordDigestInput,
): SerializedReportingPeriodDigestInput {
  return {
    schemaVersion: REPORTING_PERIOD_SCHEMA_VERSION,
    organizationId: input.organizationId,
    exchangeAccountId: input.exchangeAccountId,
    periodStart: toIsoTimestamp(input.periodStart),
    periodEnd: input.periodEnd ? toIsoTimestamp(input.periodEnd) : null,
    startingEquity: input.startingEquity,
    endingEquity: input.endingEquity,
    openPositionsSnapshotRef: input.openPositionsSnapshotRef,
    realizedPnl: input.realizedPnl,
    unrealizedPnl: input.unrealizedPnl,
    netDeposits: input.netDeposits,
    netWithdrawals: input.netWithdrawals,
    valuationSource: input.valuationSource,
    startingSnapshotAt: toIsoTimestamp(input.startingSnapshotAt),
    endingSnapshotAt: input.endingSnapshotAt ? toIsoTimestamp(input.endingSnapshotAt) : null,
    status: input.status,
  };
}

export function computeReportingPeriodRecordDigest(
  input: ReportingPeriodRecordDigestInput,
): string {
  const canonical = serializeReportingPeriodDigestInput(input);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function buildReportingPeriodRecordPayload(
  input: ReportingPeriodRecordDigestInput,
): ReportingPeriodRecordPayload {
  const recordContentDigest = computeReportingPeriodRecordDigest(input);
  return {
    ...input,
    schemaVersion: REPORTING_PERIOD_SCHEMA_VERSION,
    recordContentDigest,
  };
}

export function verifyReportingPeriodRecordDigest(payload: ReportingPeriodRecordPayload): void {
  const { recordContentDigest, schemaVersion: _schemaVersion, ...digestInput } = payload;
  const expected = computeReportingPeriodRecordDigest(digestInput);
  if (expected !== recordContentDigest) {
    throw new ReportingPeriodDigestMismatchError();
  }
}
