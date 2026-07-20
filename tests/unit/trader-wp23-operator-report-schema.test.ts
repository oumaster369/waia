import { describe, expect, it } from "vitest";

import {
  HTR_OPERATOR_REPORT_SCHEMA_VERSION,
  assertHtrOperatorReportSchemaV1,
  computeHtrOperatorReportDigest,
} from "@/lib/trader/readiness/htr-operator-report-schema.v1";

function buildMinimalOperatorReport() {
  return {
    schemaVersion: HTR_OPERATOR_REPORT_SCHEMA_VERSION,
    reportId: "00000000-0000-4000-8022-000000000001",
    runId: "fhv-run-001",
    generatedAtUtc: "2026-07-17T00:00:00.000Z",
    capital: {
      initialEquityUsdt: "100000",
      finalEquityUsdt: "100000",
      minimumEquityUsdt: "100000",
      maximumEquityUsdt: "100000",
    },
    returns: {
      grossPnlUsdt: "0",
      netPnlUsdt: "0",
      totalReturnPct: "0",
      annualizedReturnPct: "0",
      realizedPnlUsdt: "0",
      unrealizedPnlUsdt: "0",
    },
    costs: {
      feesUsdt: "0",
      spreadCostUsdt: "0",
      slippageUsdt: "0",
      impactCostUsdt: "0",
      totalCostUsdt: "0",
      feeDragPct: "0",
    },
    drawdown: {
      maxClosedBarDrawdownUsdt: "0",
      maxClosedBarDrawdownPct: "0",
      maxAdverseIntrabarDrawdownUsdt: "0",
      maxAdverseIntrabarDrawdownPct: "0",
      drawdownStartUtc: "NOT_OBSERVED",
      drawdownTroughUtc: "NOT_OBSERVED",
      drawdownRecoveryUtc: "NOT_OBSERVED",
      maxDrawdownDuration: "0",
      recoveryDuration: "0",
      recovered: true,
    },
    trades: {
      tradeCount: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: "0",
      averageWinUsdt: "0",
      averageLossUsdt: "0",
      payoffRatio: "0",
      profitFactor: "0",
      expectancyPerTradeUsdt: "0",
      consecutiveLossMax: 0,
    },
    provenance: {
      codeSha: "abc123",
      dirtyTree: false,
      datasetManifestDigest: "fd7d489595f8fc20e4311c74e5d82b2957e7cca5b80319b8cb8d5f0893544663",
      runConfigDigest: "run-config-digest",
      strategyVersions: ["mean-reversion-v0@0.1.0"],
      costModelVersion: "waia.trader.cost-model.v1",
      riskPolicyVersion: "htr-wp16-d20-drawdown/v1",
      initialPortfolioDigest: "initial-portfolio-digest",
    },
    holdoutAccessStatus: "SEALED_NOT_ACCESSED" as const,
    billingHwmDistinctFromRiskDrawdown: true as const,
  };
}

describe("HTR-WP23 operator report schema v1", () => {
  it("accepts minimal valid report", () => {
    const report = buildMinimalOperatorReport();
    expect(() => assertHtrOperatorReportSchemaV1(report)).not.toThrow();
    expect(computeHtrOperatorReportDigest(report)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects missing provenance keys", () => {
    const report = buildMinimalOperatorReport();
    const broken = {
      ...report,
      provenance: { ...report.provenance, runConfigDigest: undefined },
    };
    expect(() => assertHtrOperatorReportSchemaV1(broken)).toThrow(
      /HTR_WP23_OPERATOR_REPORT:PROVENANCE_MISSING_KEY:runConfigDigest/,
    );
  });

  it("requires billing HWM distinction flag", () => {
    const report = buildMinimalOperatorReport();
    const broken = { ...report, billingHwmDistinctFromRiskDrawdown: false };
    expect(() => assertHtrOperatorReportSchemaV1(broken)).toThrow(
      /HTR_WP23_OPERATOR_REPORT:BILLING_HWM_DISTINCTION_REQUIRED/,
    );
  });
});
