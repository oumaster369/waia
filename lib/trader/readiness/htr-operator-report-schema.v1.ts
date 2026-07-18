import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

export const HTR_OPERATOR_REPORT_SCHEMA_VERSION = "htr-operator-report/v1" as const;

export type HtrOperatorReportCapitalSection = Readonly<{
  initialEquityUsdt: string;
  finalEquityUsdt: string;
  minimumEquityUsdt: string;
  maximumEquityUsdt: string;
}>;

export type HtrOperatorReportReturnsSection = Readonly<{
  grossPnlUsdt: string;
  netPnlUsdt: string;
  totalReturnPct: string;
  annualizedReturnPct: string;
  realizedPnlUsdt: string;
  unrealizedPnlUsdt: string;
}>;

export type HtrOperatorReportCostsSection = Readonly<{
  feesUsdt: string;
  spreadCostUsdt: string;
  slippageUsdt: string;
  impactCostUsdt: string;
  totalCostUsdt: string;
  feeDragPct: string;
}>;

export type HtrOperatorReportDrawdownSection = Readonly<{
  maxClosedBarDrawdownUsdt: string;
  maxClosedBarDrawdownPct: string;
  maxAdverseIntrabarDrawdownUsdt: string;
  maxAdverseIntrabarDrawdownPct: string;
  drawdownStartUtc: string | "NOT_OBSERVED";
  drawdownTroughUtc: string | "NOT_OBSERVED";
  drawdownRecoveryUtc: string | "NOT_RECOVERED" | "NOT_OBSERVED";
  maxDrawdownDuration: string;
  recoveryDuration: string;
  recovered: boolean;
}>;

export type HtrOperatorReportTradesSection = Readonly<{
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
  winRate: string;
  averageWinUsdt: string;
  averageLossUsdt: string;
  payoffRatio: string;
  profitFactor: string;
  expectancyPerTradeUsdt: string;
  consecutiveLossMax: number;
}>;

export type HtrOperatorReportProvenanceSection = Readonly<{
  codeSha: string;
  dirtyTree: boolean;
  datasetManifestDigest: string;
  runConfigDigest: string;
  strategyVersions: readonly string[];
  costModelVersion: string;
  riskPolicyVersion: string;
  initialPortfolioDigest: string;
}>;

export type HtrOperatorReportSchemaV1 = Readonly<{
  schemaVersion: typeof HTR_OPERATOR_REPORT_SCHEMA_VERSION;
  reportId: string;
  runId: string;
  generatedAtUtc: string;
  capital: HtrOperatorReportCapitalSection;
  returns: HtrOperatorReportReturnsSection;
  costs: HtrOperatorReportCostsSection;
  drawdown: HtrOperatorReportDrawdownSection;
  trades: HtrOperatorReportTradesSection;
  provenance: HtrOperatorReportProvenanceSection;
  holdoutAccessStatus: "SEALED_NOT_ACCESSED";
  billingHwmDistinctFromRiskDrawdown: true;
}>;

export const HTR_OPERATOR_REPORT_REQUIRED_TOP_LEVEL_KEYS = [
  "schemaVersion",
  "reportId",
  "runId",
  "generatedAtUtc",
  "capital",
  "returns",
  "costs",
  "drawdown",
  "trades",
  "provenance",
  "holdoutAccessStatus",
  "billingHwmDistinctFromRiskDrawdown",
] as const;

export const HTR_OPERATOR_REPORT_REQUIRED_PROVENANCE_KEYS = [
  "codeSha",
  "dirtyTree",
  "datasetManifestDigest",
  "runConfigDigest",
  "strategyVersions",
  "costModelVersion",
  "riskPolicyVersion",
  "initialPortfolioDigest",
] as const;

export function assertHtrOperatorReportSchemaV1(
  value: unknown,
): asserts value is HtrOperatorReportSchemaV1 {
  if (typeof value !== "object" || value === null) {
    throw new Error("HTR_WP23_OPERATOR_REPORT:NOT_OBJECT");
  }
  const record = value as Record<string, unknown>;

  for (const key of HTR_OPERATOR_REPORT_REQUIRED_TOP_LEVEL_KEYS) {
    if (!(key in record)) {
      throw new Error(`HTR_WP23_OPERATOR_REPORT:MISSING_KEY:${key}`);
    }
  }

  if (record.schemaVersion !== HTR_OPERATOR_REPORT_SCHEMA_VERSION) {
    throw new Error("HTR_WP23_OPERATOR_REPORT:SCHEMA_VERSION_MISMATCH");
  }
  if (record.holdoutAccessStatus !== "SEALED_NOT_ACCESSED") {
    throw new Error("HTR_WP23_OPERATOR_REPORT:HOLDOUT_ACCESS_STATUS_INVALID");
  }
  if (record.billingHwmDistinctFromRiskDrawdown !== true) {
    throw new Error("HTR_WP23_OPERATOR_REPORT:BILLING_HWM_DISTINCTION_REQUIRED");
  }

  const provenance = record.provenance;
  if (typeof provenance !== "object" || provenance === null) {
    throw new Error("HTR_WP23_OPERATOR_REPORT:PROVENANCE_NOT_OBJECT");
  }
  const provenanceRecord = provenance as Record<string, unknown>;
  for (const key of HTR_OPERATOR_REPORT_REQUIRED_PROVENANCE_KEYS) {
    if (!(key in provenanceRecord) || provenanceRecord[key] === undefined) {
      throw new Error(`HTR_WP23_OPERATOR_REPORT:PROVENANCE_MISSING_KEY:${key}`);
    }
  }
  if (!Array.isArray(provenanceRecord.strategyVersions)) {
    throw new Error("HTR_WP23_OPERATOR_REPORT:STRATEGY_VERSIONS_NOT_ARRAY");
  }
}

export function computeHtrOperatorReportDigest(report: HtrOperatorReportSchemaV1): string {
  return computeSemanticSha256Hex(report as unknown as Record<string, unknown>);
}
