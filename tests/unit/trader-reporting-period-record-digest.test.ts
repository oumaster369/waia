import { describe, expect, it } from "vitest";

import {
  buildReportingPeriodRecordPayload,
  computeReportingPeriodRecordDigest,
  REPORTING_PERIOD_SCHEMA_VERSION,
  ReportingPeriodDigestMismatchError,
  type ReportingPeriodRecordDigestInput,
  verifyReportingPeriodRecordDigest,
} from "@/lib/trader/billing";

const PERIOD_START = new Date("2026-06-01T00:00:00.000Z");
const SNAPSHOT_AT = new Date("2026-06-01T00:05:00.000Z");

const baseDigestInput = {
  organizationId: "00000000-0000-4000-8000-0000000305",
  exchangeAccountId: "htx-paper-001",
  periodStart: PERIOD_START,
  periodEnd: null,
  startingEquity: "10000.00",
  endingEquity: null,
  openPositionsSnapshotRef: "paper-positions:2026-06-01T00:05:00.000Z",
  realizedPnl: null,
  unrealizedPnl: null,
  netDeposits: "0",
  netWithdrawals: "0",
  valuationSource: "paper_pnl_read_model.v1",
  startingSnapshotAt: SNAPSHOT_AT,
  endingSnapshotAt: null,
  status: "OPEN" as const,
} satisfies ReportingPeriodRecordDigestInput;

describe("reporting period record digest (DEE-305 S1)", () => {
  it("produces deterministic digest for identical immutable input", () => {
    const digestA = computeReportingPeriodRecordDigest(baseDigestInput);
    const digestB = computeReportingPeriodRecordDigest(baseDigestInput);
    expect(digestA).toMatch(/^[a-f0-9]{64}$/);
    expect(digestA).toBe(digestB);
  });

  it("changes digest when startingEquity changes", () => {
    const digestA = computeReportingPeriodRecordDigest(baseDigestInput);
    const digestB = computeReportingPeriodRecordDigest({
      ...baseDigestInput,
      startingEquity: "10001.00",
    });
    expect(digestA).not.toBe(digestB);
  });

  it("builds payload with matching recordContentDigest", () => {
    const payload = buildReportingPeriodRecordPayload(baseDigestInput);
    expect(payload.schemaVersion).toBe(REPORTING_PERIOD_SCHEMA_VERSION);
    expect(payload.recordContentDigest).toBe(computeReportingPeriodRecordDigest(baseDigestInput));
    expect(() => verifyReportingPeriodRecordDigest(payload)).not.toThrow();
  });

  it("rejects tampered recordContentDigest fail-closed", () => {
    const payload = buildReportingPeriodRecordPayload(baseDigestInput);
    expect(() =>
      verifyReportingPeriodRecordDigest({
        ...payload,
        recordContentDigest: "f".repeat(64),
      }),
    ).toThrow(ReportingPeriodDigestMismatchError);
  });

  it("exports schema version constant", () => {
    expect(REPORTING_PERIOD_SCHEMA_VERSION).toBe("waia.trader.reporting-period.v1");
  });
});
