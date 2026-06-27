import { describe, expect, it } from "vitest";

import {
  INVOICE_CURRENCY,
  INVOICE_SCHEMA_VERSION,
  type FeeComputationArtifact,
} from "@/lib/trader/billing";
import type { ReportingPeriodRecordView } from "@/lib/trader/billing/reporting-period.types";
import {
  buildInvoiceRecordPayloadFromSources,
  computeFeeArtifactDigest,
  computeInvoiceRecordDigest,
  serializeFeeArtifactDigestInput,
  serializeInvoiceDigestInput,
  verifyDraftInvoiceCanonicalBinding,
  verifyInvoiceRecordDigest,
} from "@/lib/trader/billing/serialize-invoice";

const FIXED_AT = new Date("2026-06-30T12:00:00.000Z");

function sampleArtifact(overrides: Partial<FeeComputationArtifact> = {}): FeeComputationArtifact {
  return {
    periodId: "period-310",
    organizationId: "org-310",
    exchangeAccountId: "htx-paper-310",
    periodRealizedStrategyProfit: "100.00",
    cumulativeRealizedStrategyProfit: "100.00",
    previousHighWaterMark: "0",
    newProfitAboveHwm: "100.00",
    feeRate: "0.30",
    performanceFee: "30.00",
    proposedNewHighWaterMark: "100.00",
    billable: true,
    unrealizedPnl: "-15.00",
    realizedFillFinality: false,
    computedAt: FIXED_AT,
    ...overrides,
  };
}

function samplePeriod(
  overrides: Partial<ReportingPeriodRecordView> = {},
): ReportingPeriodRecordView {
  return {
    id: "period-310",
    organizationId: "org-310",
    exchangeAccountId: "htx-paper-310",
    periodStart: new Date("2026-01-01T00:00:00.000Z"),
    periodEnd: new Date("2026-01-28T23:59:59.000Z"),
    startingEquity: "10000.00",
    endingEquity: "10100.00",
    openPositionsSnapshotRef: "paper-positions:jan",
    realizedPnl: "100.00",
    unrealizedPnl: "-15.00",
    netDeposits: "0",
    netWithdrawals: "0",
    valuationSource: "paper_pnl_read_model.v1",
    startingSnapshotAt: new Date("2026-01-01T00:05:00.000Z"),
    endingSnapshotAt: new Date("2026-01-28T23:55:00.000Z"),
    status: "CLOSED",
    schemaVersion: "waia.trader.reporting-period.v1",
    recordContentDigest: "period-digest",
    createdAt: FIXED_AT,
    updatedAt: FIXED_AT,
    ...overrides,
  };
}

describe("invoice serialization (DEE-310 S5)", () => {
  it("computes stable fee artifact and record digests", () => {
    const artifact = sampleArtifact();
    const period = samplePeriod();
    const disclosure = {
      startingEquity: period.startingEquity,
      endingEquity: period.endingEquity!,
      netDeposits: period.netDeposits,
      netWithdrawals: period.netWithdrawals,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd!,
      valuationSource: period.valuationSource,
    };

    const feeArtifactDigest = computeFeeArtifactDigest(artifact);
    const payload = buildInvoiceRecordPayloadFromSources(artifact, period, disclosure);

    expect(payload.schemaVersion).toBe(INVOICE_SCHEMA_VERSION);
    expect(payload.currency).toBe(INVOICE_CURRENCY);
    expect(payload.status).toBe("DRAFT");
    expect(payload.feeArtifactDigest).toBe(feeArtifactDigest);
    expect(payload.recordContentDigest).toHaveLength(64);
    expect(serializeFeeArtifactDigestInput(artifact)).toMatchObject({
      periodId: "period-310",
      performanceFee: "30.00",
      billable: true,
    });
    expect(serializeInvoiceDigestInput(payload)).toMatchObject({
      reportingPeriodId: "period-310",
      feeArtifactDigest,
      currency: "USD",
    });

    verifyInvoiceRecordDigest(payload);
    verifyDraftInvoiceCanonicalBinding(payload, artifact, period, disclosure);

    const recomputed = computeInvoiceRecordDigest(payload);
    expect(recomputed).toBe(payload.recordContentDigest);
  });

  it("detects tampered invoice record digest on verify", () => {
    const artifact = sampleArtifact();
    const period = samplePeriod();
    const payload = buildInvoiceRecordPayloadFromSources(artifact, period, {
      startingEquity: period.startingEquity,
      endingEquity: period.endingEquity!,
      netDeposits: period.netDeposits,
      netWithdrawals: period.netWithdrawals,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd!,
      valuationSource: period.valuationSource,
    });

    expect(() =>
      verifyInvoiceRecordDigest({
        ...payload,
        performanceFee: "31.00",
      }),
    ).toThrow(/INVOICE_RECORD_DIGEST_MISMATCH/);
  });
});
