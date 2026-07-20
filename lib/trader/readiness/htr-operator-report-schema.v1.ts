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

export const FHV_PNL_REPORT_KIND = "FHV_PNL_REPORT" as const;
export const FHV_MODULE_HEALTH_REPORT_KIND = "FHV_MODULE_HEALTH_REPORT" as const;
export const FHV_DECISION_TRACE_REPORT_KIND = "FHV_DECISION_TRACE_REPORT" as const;
export const FHV_EXECUTION_AND_POSITION_REPORT_KIND = "FHV_EXECUTION_AND_POSITION_REPORT" as const;
export const FHV_RECONCILIATION_REPORT_KIND = "FHV_RECONCILIATION_REPORT" as const;
export const FHV_KNOWLEDGE_AND_CALIBRATION_REPORT_KIND =
  "FHV_KNOWLEDGE_AND_CALIBRATION_REPORT" as const;

export const FHV_PNL_REPORT_SCHEMA_VERSION = "fhv-pnl-report/v1" as const;
export const FHV_MODULE_HEALTH_REPORT_SCHEMA_VERSION = "fhv-module-health-report/v1" as const;
export const FHV_DECISION_TRACE_REPORT_SCHEMA_VERSION = "fhv-decision-trace-report/v1" as const;
export const FHV_EXECUTION_AND_POSITION_REPORT_SCHEMA_VERSION =
  "fhv-execution-and-position-report/v1" as const;
export const FHV_RECONCILIATION_REPORT_SCHEMA_VERSION = "fhv-reconciliation-report/v1" as const;
export const FHV_KNOWLEDGE_AND_CALIBRATION_REPORT_SCHEMA_VERSION =
  "fhv-knowledge-and-calibration-report/v1" as const;

export type FhvReportBaseV1 = Readonly<{
  reportKind: string;
  schemaVersion: string;
  reportId: string;
  runId: string;
  organizationId: string;
  accountKey: string;
  generatedAtUtc: string;
  semanticEventsDigest: string;
  eventCount: number;
}>;

export type FhvPnlReportV1 = FhvReportBaseV1 &
  Readonly<{
    reportKind: typeof FHV_PNL_REPORT_KIND;
    schemaVersion: typeof FHV_PNL_REPORT_SCHEMA_VERSION;
    grossPnlUsdt: string;
    netPnlUsdt: string;
    totalExecutionCostUsdt: string;
    terminalEquityUsdt: string;
    profitabilityObserved: boolean;
  }>;

export type FhvModuleHealthReportV1 = FhvReportBaseV1 &
  Readonly<{
    reportKind: typeof FHV_MODULE_HEALTH_REPORT_KIND;
    schemaVersion: typeof FHV_MODULE_HEALTH_REPORT_SCHEMA_VERSION;
    moduleSummaries: readonly {
      moduleName: string;
      moduleVersion: string;
      eventCount: number;
      errorEventCount: number;
      degradedEventCount: number;
      healthyByEvidence: boolean;
    }[];
    overallHealthyByEvidence: boolean;
  }>;

export type FhvDecisionTraceReportV1 = FhvReportBaseV1 &
  Readonly<{
    reportKind: typeof FHV_DECISION_TRACE_REPORT_KIND;
    schemaVersion: typeof FHV_DECISION_TRACE_REPORT_SCHEMA_VERSION;
    decisionEvents: readonly {
      cycleId: string;
      eventType: string;
      inputDigest: string;
      outputDigest: string;
      correlationId: string;
    }[];
  }>;

export type FhvExecutionAndPositionReportV1 = FhvReportBaseV1 &
  Readonly<{
    reportKind: typeof FHV_EXECUTION_AND_POSITION_REPORT_KIND;
    schemaVersion: typeof FHV_EXECUTION_AND_POSITION_REPORT_SCHEMA_VERSION;
    executionEventCount: number;
    positionEventCount: number;
    cycleIds: readonly string[];
  }>;

export type FhvReconciliationReportV1 = FhvReportBaseV1 &
  Readonly<{
    reportKind: typeof FHV_RECONCILIATION_REPORT_KIND;
    schemaVersion: typeof FHV_RECONCILIATION_REPORT_SCHEMA_VERSION;
    reconciliationEventCount: number;
    reconciliationFailures: number;
    reconciled: boolean;
  }>;

export type FhvKnowledgeAndCalibrationReportV1 = FhvReportBaseV1 &
  Readonly<{
    reportKind: typeof FHV_KNOWLEDGE_AND_CALIBRATION_REPORT_KIND;
    schemaVersion: typeof FHV_KNOWLEDGE_AND_CALIBRATION_REPORT_SCHEMA_VERSION;
    calibrationEventCount: number;
    knowledgeUpdateEventCount: number;
    epistemicClosureObserved: boolean;
  }>;

export type FhvReportV1 =
  | FhvPnlReportV1
  | FhvModuleHealthReportV1
  | FhvDecisionTraceReportV1
  | FhvExecutionAndPositionReportV1
  | FhvReconciliationReportV1
  | FhvKnowledgeAndCalibrationReportV1;

function assertFhvReportBase(value: Record<string, unknown>): void {
  for (const key of [
    "reportKind",
    "schemaVersion",
    "reportId",
    "runId",
    "organizationId",
    "accountKey",
    "generatedAtUtc",
    "semanticEventsDigest",
    "eventCount",
  ] as const) {
    if (!(key in value) || value[key] === undefined) {
      throw new Error(`FHV_REPORT:MISSING_KEY:${key}`);
    }
  }
}

export function assertFhvPnlReportV1(value: unknown): asserts value is FhvPnlReportV1 {
  if (typeof value !== "object" || value === null) {
    throw new Error("FHV_PNL_REPORT:NOT_OBJECT");
  }
  const record = value as Record<string, unknown>;
  assertFhvReportBase(record);
  if (record.reportKind !== FHV_PNL_REPORT_KIND) {
    throw new Error("FHV_PNL_REPORT:KIND_MISMATCH");
  }
  if (record.schemaVersion !== FHV_PNL_REPORT_SCHEMA_VERSION) {
    throw new Error("FHV_PNL_REPORT:SCHEMA_VERSION_MISMATCH");
  }
}

export function assertFhvModuleHealthReportV1(
  value: unknown,
): asserts value is FhvModuleHealthReportV1 {
  if (typeof value !== "object" || value === null) {
    throw new Error("FHV_MODULE_HEALTH_REPORT:NOT_OBJECT");
  }
  const record = value as Record<string, unknown>;
  assertFhvReportBase(record);
  if (record.reportKind !== FHV_MODULE_HEALTH_REPORT_KIND) {
    throw new Error("FHV_MODULE_HEALTH_REPORT:KIND_MISMATCH");
  }
  if (record.schemaVersion !== FHV_MODULE_HEALTH_REPORT_SCHEMA_VERSION) {
    throw new Error("FHV_MODULE_HEALTH_REPORT:SCHEMA_VERSION_MISMATCH");
  }
  if (!Array.isArray(record.moduleSummaries)) {
    throw new Error("FHV_MODULE_HEALTH_REPORT:MODULE_SUMMARIES_NOT_ARRAY");
  }
}

export function assertFhvDecisionTraceReportV1(
  value: unknown,
): asserts value is FhvDecisionTraceReportV1 {
  if (typeof value !== "object" || value === null) {
    throw new Error("FHV_DECISION_TRACE_REPORT:NOT_OBJECT");
  }
  const record = value as Record<string, unknown>;
  assertFhvReportBase(record);
  if (record.reportKind !== FHV_DECISION_TRACE_REPORT_KIND) {
    throw new Error("FHV_DECISION_TRACE_REPORT:KIND_MISMATCH");
  }
  if (record.schemaVersion !== FHV_DECISION_TRACE_REPORT_SCHEMA_VERSION) {
    throw new Error("FHV_DECISION_TRACE_REPORT:SCHEMA_VERSION_MISMATCH");
  }
}

export function assertFhvExecutionAndPositionReportV1(
  value: unknown,
): asserts value is FhvExecutionAndPositionReportV1 {
  if (typeof value !== "object" || value === null) {
    throw new Error("FHV_EXECUTION_AND_POSITION_REPORT:NOT_OBJECT");
  }
  const record = value as Record<string, unknown>;
  assertFhvReportBase(record);
  if (record.reportKind !== FHV_EXECUTION_AND_POSITION_REPORT_KIND) {
    throw new Error("FHV_EXECUTION_AND_POSITION_REPORT:KIND_MISMATCH");
  }
  if (record.schemaVersion !== FHV_EXECUTION_AND_POSITION_REPORT_SCHEMA_VERSION) {
    throw new Error("FHV_EXECUTION_AND_POSITION_REPORT:SCHEMA_VERSION_MISMATCH");
  }
}

export function assertFhvReconciliationReportV1(
  value: unknown,
): asserts value is FhvReconciliationReportV1 {
  if (typeof value !== "object" || value === null) {
    throw new Error("FHV_RECONCILIATION_REPORT:NOT_OBJECT");
  }
  const record = value as Record<string, unknown>;
  assertFhvReportBase(record);
  if (record.reportKind !== FHV_RECONCILIATION_REPORT_KIND) {
    throw new Error("FHV_RECONCILIATION_REPORT:KIND_MISMATCH");
  }
  if (record.schemaVersion !== FHV_RECONCILIATION_REPORT_SCHEMA_VERSION) {
    throw new Error("FHV_RECONCILIATION_REPORT:SCHEMA_VERSION_MISMATCH");
  }
}

export function assertFhvKnowledgeAndCalibrationReportV1(
  value: unknown,
): asserts value is FhvKnowledgeAndCalibrationReportV1 {
  if (typeof value !== "object" || value === null) {
    throw new Error("FHV_KNOWLEDGE_AND_CALIBRATION_REPORT:NOT_OBJECT");
  }
  const record = value as Record<string, unknown>;
  assertFhvReportBase(record);
  if (record.reportKind !== FHV_KNOWLEDGE_AND_CALIBRATION_REPORT_KIND) {
    throw new Error("FHV_KNOWLEDGE_AND_CALIBRATION_REPORT:KIND_MISMATCH");
  }
  if (record.schemaVersion !== FHV_KNOWLEDGE_AND_CALIBRATION_REPORT_SCHEMA_VERSION) {
    throw new Error("FHV_KNOWLEDGE_AND_CALIBRATION_REPORT:SCHEMA_VERSION_MISMATCH");
  }
}

export function computeFhvReportDigest(report: FhvReportV1): string {
  return computeSemanticSha256Hex(report as unknown as Record<string, unknown>);
}
