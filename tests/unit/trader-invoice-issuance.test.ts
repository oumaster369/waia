import { describe, expect, it } from "vitest";

import {
  INVOICE_TRANSITIONS,
  assertAllowedInvoiceTransition,
  computeApprovalExpiresAt,
  computeCoolingOffUntil,
  isIssuanceAttestationComplete,
  isTerminalInvoiceStatus,
  type FeeComputationArtifact,
} from "@/lib/trader/billing";
import type { ReportingPeriodRecordView } from "@/lib/trader/billing/reporting-period.types";
import {
  buildInvoiceRecordPayloadFromSources,
  verifyInvoiceRecordDigest,
} from "@/lib/trader/billing/serialize-invoice";

const FIXED_AT = new Date("2026-06-30T12:00:00.000Z");

function sampleArtifact(overrides: Partial<FeeComputationArtifact> = {}): FeeComputationArtifact {
  return {
    periodId: "period-311",
    organizationId: "org-311",
    exchangeAccountId: "htx-paper-311",
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
    id: "period-311",
    organizationId: "org-311",
    exchangeAccountId: "htx-paper-311",
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

describe("invoice issuance architecture (DEE-311 S6)", () => {
  it("defines DRAFT -> ISSUED as the only forward invoice transition", () => {
    expect(INVOICE_TRANSITIONS.DRAFT).toEqual(["ISSUED"]);
    expect(INVOICE_TRANSITIONS.ISSUED).toEqual([]);
    expect(isTerminalInvoiceStatus("ISSUED")).toBe(true);
    expect(() => assertAllowedInvoiceTransition("ISSUED", "DRAFT")).toThrow(
      /Invalid invoice transition/,
    );
  });

  it("requires every ADR-0008 attestation item for approval", () => {
    expect(
      isIssuanceAttestationComplete({
        depositsVerified: true,
        withdrawalsVerified: true,
        balanceSnapshotsVerified: true,
        reconciliationVerified: true,
        exchangeSyncVerified: true,
        realizedFillFinalityVerified: true,
      }),
    ).toBe(true);
    expect(
      isIssuanceAttestationComplete({
        depositsVerified: false,
        withdrawalsVerified: true,
        balanceSnapshotsVerified: true,
        reconciliationVerified: true,
        exchangeSyncVerified: true,
        realizedFillFinalityVerified: true,
      }),
    ).toBe(false);
  });

  it("computes cooling-off and approval validity windows", () => {
    const approvedAt = new Date("2026-06-01T12:00:00.000Z");
    const coolingOffUntil = computeCoolingOffUntil(approvedAt, 60_000);
    const expiresAt = computeApprovalExpiresAt(approvedAt, 3_600_000);

    expect(coolingOffUntil.getTime()).toBe(approvedAt.getTime() + 60_000);
    expect(expiresAt.getTime()).toBeGreaterThan(coolingOffUntil.getTime());
  });

  it("verifies stored DRAFT digests unchanged when live status becomes ISSUED", () => {
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

    const payload = buildInvoiceRecordPayloadFromSources(artifact, period, disclosure);
    const issuedView = {
      ...payload,
      status: "ISSUED" as const,
      issuanceApprovedAt: FIXED_AT,
      issuanceApprovedBy: "operator-311",
      coolingOffUntil: new Date(FIXED_AT.getTime() + 60_000),
      issuedAt: new Date(FIXED_AT.getTime() + 120_000),
      issuedBy: "operator-311",
      id: "invoice-311",
      createdAt: FIXED_AT,
      updatedAt: FIXED_AT,
    };

    expect(() => verifyInvoiceRecordDigest(issuedView)).not.toThrow();
  });
});
