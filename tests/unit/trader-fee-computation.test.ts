import { describe, expect, it } from "vitest";

import {
  MIN_FEE_THRESHOLD,
  PERFORMANCE_FEE_RATE,
  computeFeeComputation,
  foldCumulativeRealizedStrategyProfit,
  selectClosedPeriodsUpToTarget,
  sortClosedReportingPeriodsChronologically,
  type ReportingPeriodRecordView,
} from "@/lib/trader/billing";

const FIXED_AT = new Date("2026-06-30T12:00:00.000Z");

function closedPeriod(
  overrides: Partial<ReportingPeriodRecordView> &
    Pick<ReportingPeriodRecordView, "id" | "realizedPnl">,
): ReportingPeriodRecordView {
  return {
    schemaVersion: "waia.trader.reporting-period.v1",
    organizationId: "org-309",
    exchangeAccountId: "htx-paper-309",
    periodStart: new Date("2026-06-01T00:00:00.000Z"),
    periodEnd: new Date("2026-06-30T23:59:59.000Z"),
    startingEquity: "10000.00",
    endingEquity: "10100.00",
    openPositionsSnapshotRef: "paper-positions:ref",
    unrealizedPnl: "0",
    netDeposits: "0",
    netWithdrawals: "0",
    valuationSource: "paper_pnl_read_model.v1",
    startingSnapshotAt: new Date("2026-06-01T00:05:00.000Z"),
    endingSnapshotAt: new Date("2026-06-30T23:55:00.000Z"),
    status: "CLOSED",
    recordContentDigest: "abc123",
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-30T23:59:59.000Z"),
    ...overrides,
  };
}

describe("fee computation core (DEE-309 S4)", () => {
  it("computes decimal-safe fee math", () => {
    const artifact = computeFeeComputation({
      periodId: "p1",
      organizationId: "org-309",
      exchangeAccountId: "htx-paper-309",
      periodRealizedStrategyProfit: "100.50",
      cumulativeRealizedStrategyProfit: "100.50",
      previousHighWaterMark: "0",
      unrealizedPnl: "-50.00",
      realizedFillFinality: true,
      computedAt: FIXED_AT,
    });

    expect(artifact.feeRate).toBe(PERFORMANCE_FEE_RATE);
    expect(artifact.newProfitAboveHwm).toBe("100.5");
    expect(artifact.performanceFee).toBe("30.15");
    expect(artifact.proposedNewHighWaterMark).toBe("100.5");
  });

  it("folds cumulative RSP deterministically in chronological order", () => {
    const periods = sortClosedReportingPeriodsChronologically([
      closedPeriod({
        id: "p3",
        realizedPnl: "30",
        periodStart: new Date("2026-03-01T00:00:00.000Z"),
        periodEnd: new Date("2026-03-31T23:59:59.000Z"),
      }),
      closedPeriod({
        id: "p1",
        realizedPnl: "100",
        periodStart: new Date("2026-01-01T00:00:00.000Z"),
        periodEnd: new Date("2026-01-31T23:59:59.000Z"),
      }),
      closedPeriod({
        id: "p2",
        realizedPnl: "-40",
        periodStart: new Date("2026-02-01T00:00:00.000Z"),
        periodEnd: new Date("2026-02-28T23:59:59.000Z"),
      }),
    ]);

    expect(periods.map((period) => period.id)).toEqual(["p1", "p2", "p3"]);
    expect(foldCumulativeRealizedStrategyProfit(periods)).toBe("90");

    const upToP2 = selectClosedPeriodsUpToTarget(periods, "p2");
    expect(upToP2.map((period) => period.id)).toEqual(["p1", "p2"]);
    expect(foldCumulativeRealizedStrategyProfit(upToP2)).toBe("60");
  });

  it("rebuilds cumulative RSP identically with no cached state", () => {
    const periods = [
      closedPeriod({ id: "p1", realizedPnl: "100" }),
      closedPeriod({
        id: "p2",
        realizedPnl: "-40",
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd: new Date("2026-07-31T23:59:59.000Z"),
      }),
    ];

    const first = foldCumulativeRealizedStrategyProfit(
      sortClosedReportingPeriodsChronologically(periods),
    );
    const second = foldCumulativeRealizedStrategyProfit(
      sortClosedReportingPeriodsChronologically([...periods].reverse()),
    );

    expect(first).toBe("60");
    expect(second).toBe("60");
  });

  it("is invariant to deposits and withdrawals when realized_pnl is fixed", () => {
    const baseInput = {
      periodId: "p1",
      organizationId: "org-309",
      exchangeAccountId: "htx-paper-309",
      periodRealizedStrategyProfit: "100",
      cumulativeRealizedStrategyProfit: "100",
      previousHighWaterMark: "0",
      unrealizedPnl: "0",
      realizedFillFinality: false,
      computedAt: FIXED_AT,
    };

    const withoutCapitalMovement = computeFeeComputation(baseInput);
    const withCapitalMovement = computeFeeComputation({
      ...baseInput,
      periodId: "p2",
    });

    expect(withoutCapitalMovement.newProfitAboveHwm).toBe(withCapitalMovement.newProfitAboveHwm);
    expect(withoutCapitalMovement.performanceFee).toBe(withCapitalMovement.performanceFee);
    expect(withoutCapitalMovement.proposedNewHighWaterMark).toBe(
      withCapitalMovement.proposedNewHighWaterMark,
    );
  });

  it("returns zero fee and not billable for negative or zero period RSP below HWM", () => {
    const negative = computeFeeComputation({
      periodId: "p-loss",
      organizationId: "org-309",
      exchangeAccountId: "htx-paper-309",
      periodRealizedStrategyProfit: "-40",
      cumulativeRealizedStrategyProfit: "60",
      previousHighWaterMark: "100",
      unrealizedPnl: "-200",
      realizedFillFinality: false,
      computedAt: FIXED_AT,
    });

    expect(negative.newProfitAboveHwm).toBe("0");
    expect(negative.performanceFee).toBe("0");
    expect(negative.billable).toBe(false);
    expect(negative.proposedNewHighWaterMark).toBe("100");
  });

  it("charges only on cumulative profit above HWM", () => {
    const belowHwm = computeFeeComputation({
      periodId: "p2",
      organizationId: "org-309",
      exchangeAccountId: "htx-paper-309",
      periodRealizedStrategyProfit: "-10",
      cumulativeRealizedStrategyProfit: "90",
      previousHighWaterMark: "100",
      unrealizedPnl: null,
      realizedFillFinality: false,
      computedAt: FIXED_AT,
    });

    expect(belowHwm.newProfitAboveHwm).toBe("0");
    expect(belowHwm.performanceFee).toBe("0");

    const firstDollarAbove = computeFeeComputation({
      periodId: "p3",
      organizationId: "org-309",
      exchangeAccountId: "htx-paper-309",
      periodRealizedStrategyProfit: "11",
      cumulativeRealizedStrategyProfit: "101",
      previousHighWaterMark: "100",
      unrealizedPnl: null,
      realizedFillFinality: false,
      computedAt: FIXED_AT,
    });

    expect(firstDollarAbove.newProfitAboveHwm).toBe("1");
    expect(firstDollarAbove.performanceFee).toBe("0.3");
  });

  it("regresses multi-period drawdown recovery without double-charge", () => {
    const sequence = [
      { id: "p1", cumulative: "100", previousHwm: "0", expectedBase: "100" },
      { id: "p2", cumulative: "60", previousHwm: "100", expectedBase: "0" },
      { id: "p3", cumulative: "90", previousHwm: "100", expectedBase: "0" },
      { id: "p4", cumulative: "140", previousHwm: "100", expectedBase: "40" },
    ] as const;

    let totalFeeBase = "0";

    for (const step of sequence) {
      const artifact = computeFeeComputation({
        periodId: step.id,
        organizationId: "org-309",
        exchangeAccountId: "htx-paper-309",
        periodRealizedStrategyProfit: step.expectedBase,
        cumulativeRealizedStrategyProfit: step.cumulative,
        previousHighWaterMark: step.previousHwm,
        unrealizedPnl: "0",
        realizedFillFinality: true,
        computedAt: FIXED_AT,
      });

      expect(artifact.newProfitAboveHwm).toBe(step.expectedBase);
      totalFeeBase = `${Number.parseFloat(totalFeeBase) + Number.parseFloat(step.expectedBase)}`;
    }

    expect(totalFeeBase).toBe("140");
  });

  it("charges 30% of full period RSP on first profitable period after bootstrap-at-zero", () => {
    const artifact = computeFeeComputation({
      periodId: "p1",
      organizationId: "org-309",
      exchangeAccountId: "htx-paper-309",
      periodRealizedStrategyProfit: "100",
      cumulativeRealizedStrategyProfit: "100",
      previousHighWaterMark: "0",
      unrealizedPnl: "25",
      realizedFillFinality: false,
      computedAt: FIXED_AT,
    });

    expect(artifact.newProfitAboveHwm).toBe("100");
    expect(artifact.performanceFee).toBe("30");
    expect(artifact.proposedNewHighWaterMark).toBe("100");
  });

  it("passes through unrealized PnL and realizedFillFinality", () => {
    const artifact = computeFeeComputation({
      periodId: "p1",
      organizationId: "org-309",
      exchangeAccountId: "htx-paper-309",
      periodRealizedStrategyProfit: "50",
      cumulativeRealizedStrategyProfit: "50",
      previousHighWaterMark: "0",
      unrealizedPnl: "-120.50",
      realizedFillFinality: true,
      computedAt: FIXED_AT,
    });

    expect(artifact.unrealizedPnl).toBe("-120.50");
    expect(artifact.realizedFillFinality).toBe(true);
  });

  it("sets billable from MIN_FEE_THRESHOLD", () => {
    const belowThreshold = computeFeeComputation({
      periodId: "p-small",
      organizationId: "org-309",
      exchangeAccountId: "htx-paper-309",
      periodRealizedStrategyProfit: "20",
      cumulativeRealizedStrategyProfit: "20",
      previousHighWaterMark: "0",
      unrealizedPnl: null,
      realizedFillFinality: false,
      computedAt: FIXED_AT,
    });

    expect(belowThreshold.performanceFee).toBe("6");
    expect(belowThreshold.billable).toBe(false);
    expect(MIN_FEE_THRESHOLD).toBe("10.00");

    const aboveThreshold = computeFeeComputation({
      periodId: "p-large",
      organizationId: "org-309",
      exchangeAccountId: "htx-paper-309",
      periodRealizedStrategyProfit: "50",
      cumulativeRealizedStrategyProfit: "50",
      previousHighWaterMark: "0",
      unrealizedPnl: null,
      realizedFillFinality: false,
      computedAt: FIXED_AT,
    });

    expect(aboveThreshold.performanceFee).toBe("15");
    expect(aboveThreshold.billable).toBe(true);
  });

  it("is idempotent for identical immutable inputs", () => {
    const input = {
      periodId: "p1",
      organizationId: "org-309",
      exchangeAccountId: "htx-paper-309",
      periodRealizedStrategyProfit: "100",
      cumulativeRealizedStrategyProfit: "100",
      previousHighWaterMark: "0",
      unrealizedPnl: "0",
      realizedFillFinality: true,
      computedAt: FIXED_AT,
    };

    const first = computeFeeComputation(input);
    const second = computeFeeComputation(input);

    expect(first).toEqual(second);
  });
});
