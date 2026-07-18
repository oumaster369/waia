import { describe, expect, it } from "vitest";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { FHV_SEMANTIC_EVENT_SCHEMA_VERSION } from "@/lib/trader/observability/fhv-semantic-event.types";
import { buildFhvDecisionTraceReportV1 } from "@/lib/trader/readiness/build-fhv-decision-trace-report.v1";
import { buildFhvExecutionAndPositionReportV1 } from "@/lib/trader/readiness/build-fhv-execution-position-report.v1";
import { buildFhvKnowledgeAndCalibrationReportV1 } from "@/lib/trader/readiness/build-fhv-knowledge-calibration-report.v1";
import { buildFhvModuleHealthReportV1 } from "@/lib/trader/readiness/build-fhv-module-health-report.v1";
import { buildFhvPnlReportV1 } from "@/lib/trader/readiness/build-fhv-pnl-report.v1";
import { buildFhvReconciliationReportV1 } from "@/lib/trader/readiness/build-fhv-reconciliation-report.v1";
import {
  buildHtrOperatorReportV1,
  reconcileOperatorReportWithSemanticEvents,
} from "@/lib/trader/readiness/build-htr-operator-report.v1";
import {
  assertFhvDecisionTraceReportV1,
  assertFhvExecutionAndPositionReportV1,
  assertFhvKnowledgeAndCalibrationReportV1,
  assertFhvModuleHealthReportV1,
  assertFhvPnlReportV1,
  assertFhvReconciliationReportV1,
  assertHtrOperatorReportSchemaV1,
  FHV_DECISION_TRACE_REPORT_KIND,
  FHV_EXECUTION_AND_POSITION_REPORT_KIND,
  FHV_KNOWLEDGE_AND_CALIBRATION_REPORT_KIND,
  FHV_MODULE_HEALTH_REPORT_KIND,
  FHV_PNL_REPORT_KIND,
  FHV_RECONCILIATION_REPORT_KIND,
} from "@/lib/trader/readiness/htr-operator-report-schema.v1";
import { reconcileFhvReportsWithSemanticEvents } from "@/lib/trader/readiness/htr-readiness-evidence-harness";

const RUN_ID = "corrective-a4-operator-run";
const ORG_ID = "00000000-0000-4000-8000-0000000415a4";
const ACCOUNT_KEY = "corrective-a4";

function semanticEvents() {
  return [
    {
      schemaVersion: FHV_SEMANTIC_EVENT_SCHEMA_VERSION,
      runId: RUN_ID,
      cycleId: "0",
      moduleName: "paper-cycle",
      moduleVersion: "1.0.0",
      eventType: "CYCLE_COMPLETE",
      inputDigest: computeSemanticSha256Hex({ cycleId: "0" }),
      outputDigest: computeSemanticSha256Hex({ ok: true }),
      stateDigest: computeSemanticSha256Hex([]),
      seq: 0,
      timestampUtc: "2026-07-18T00:00:00.000Z",
      correlationId: `${RUN_ID}:0`,
    },
    {
      schemaVersion: FHV_SEMANTIC_EVENT_SCHEMA_VERSION,
      runId: RUN_ID,
      cycleId: "0",
      moduleName: "reconciliation",
      moduleVersion: "1.0.0",
      eventType: "RECONCILIATION_OK",
      inputDigest: computeSemanticSha256Hex({ cycleId: "0" }),
      outputDigest: computeSemanticSha256Hex({ ok: true }),
      stateDigest: computeSemanticSha256Hex([]),
      seq: 1,
      timestampUtc: "2026-07-18T00:00:01.000Z",
      correlationId: `${RUN_ID}:0:reconciliation`,
    },
  ] as const;
}

function buildInput() {
  return {
    reportId: "00000000-0000-4000-8022-0000000000a4",
    runId: RUN_ID,
    organizationId: ORG_ID,
    accountKey: ACCOUNT_KEY,
    generatedAtUtc: "2026-07-18T00:00:02.000Z",
    semanticEvents: semanticEvents(),
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
  };
}

describe("DEE-415 C-A4 operator + FHV report builders (G4)", () => {
  it("buildHtrOperatorReportV1 passes schema validation", () => {
    const report = buildHtrOperatorReportV1(buildInput());
    expect(() => assertHtrOperatorReportSchemaV1(report)).not.toThrow();
    expect(report.billingHwmDistinctFromRiskDrawdown).toBe(true);
  });

  it("six FHV builders produce valid reports with canonical kinds", () => {
    const input = buildInput();
    const pnl = buildFhvPnlReportV1(input);
    const moduleHealth = buildFhvModuleHealthReportV1(input);
    const decisionTrace = buildFhvDecisionTraceReportV1(input);
    const executionPosition = buildFhvExecutionAndPositionReportV1(input);
    const reconciliation = buildFhvReconciliationReportV1(input);
    const knowledge = buildFhvKnowledgeAndCalibrationReportV1(input);

    expect(() => assertFhvPnlReportV1(pnl)).not.toThrow();
    expect(() => assertFhvModuleHealthReportV1(moduleHealth)).not.toThrow();
    expect(() => assertFhvDecisionTraceReportV1(decisionTrace)).not.toThrow();
    expect(() => assertFhvExecutionAndPositionReportV1(executionPosition)).not.toThrow();
    expect(() => assertFhvReconciliationReportV1(reconciliation)).not.toThrow();
    expect(() => assertFhvKnowledgeAndCalibrationReportV1(knowledge)).not.toThrow();

    expect(pnl.reportKind).toBe(FHV_PNL_REPORT_KIND);
    expect(moduleHealth.reportKind).toBe(FHV_MODULE_HEALTH_REPORT_KIND);
    expect(decisionTrace.reportKind).toBe(FHV_DECISION_TRACE_REPORT_KIND);
    expect(executionPosition.reportKind).toBe(FHV_EXECUTION_AND_POSITION_REPORT_KIND);
    expect(reconciliation.reportKind).toBe(FHV_RECONCILIATION_REPORT_KIND);
    expect(knowledge.reportKind).toBe(FHV_KNOWLEDGE_AND_CALIBRATION_REPORT_KIND);
  });

  it("requires billing HWM distinct from risk drawdown", () => {
    const report = buildHtrOperatorReportV1(buildInput());
    expect(report.billingHwmDistinctFromRiskDrawdown).toBe(true);
    expect(report.holdoutAccessStatus).toBe("SEALED_NOT_ACCESSED");
  });

  it("reconciles operator and FHV reports against semantic events", () => {
    const input = buildInput();
    const operatorReport = buildHtrOperatorReportV1(input);
    const reports = {
      operatorReport,
      fhvPnlReport: buildFhvPnlReportV1(input),
      fhvModuleHealthReport: buildFhvModuleHealthReportV1(input),
      fhvDecisionTraceReport: buildFhvDecisionTraceReportV1(input),
      fhvExecutionAndPositionReport: buildFhvExecutionAndPositionReportV1(input),
      fhvReconciliationReport: buildFhvReconciliationReportV1(input),
      fhvKnowledgeAndCalibrationReport: buildFhvKnowledgeAndCalibrationReportV1(input),
    };

    expect(reconcileOperatorReportWithSemanticEvents(operatorReport, input.semanticEvents)).toBe(
      true,
    );
    expect(reconcileFhvReportsWithSemanticEvents(reports, input.semanticEvents)).toBe(true);
  });
});
