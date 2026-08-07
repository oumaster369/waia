import {
  assertFhvPnlReportV1,
  FHV_PNL_REPORT_KIND,
  FHV_PNL_REPORT_SCHEMA_VERSION,
  type FhvPnlReportV1,
} from "@/lib/trader/readiness/htr-operator-report-schema.v1";
import {
  buildHtrOperatorReportV1,
  buildSemanticEventsDigest,
  type BuildHtrOperatorReportInputV1,
  type FhvReportBuildInput,
} from "@/lib/trader/readiness/build-htr-operator-report.v1";
import { compareDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";

export type BuildFhvPnlReportInputV1 = BuildHtrOperatorReportInputV1;

export function buildFhvPnlReportV1(input: BuildFhvPnlReportInputV1): FhvPnlReportV1 {
  const operatorReport = buildHtrOperatorReportV1(input);
  const report: FhvPnlReportV1 = {
    reportKind: FHV_PNL_REPORT_KIND,
    schemaVersion: FHV_PNL_REPORT_SCHEMA_VERSION,
    reportId: input.reportId,
    runId: input.runId,
    organizationId: input.organizationId,
    accountKey: input.accountKey,
    generatedAtUtc: input.generatedAtUtc,
    semanticEventsDigest: buildSemanticEventsDigest(input.semanticEvents),
    eventCount: input.semanticEvents.length,
    grossPnlUsdt: operatorReport.returns.grossPnlUsdt,
    netPnlUsdt: operatorReport.returns.netPnlUsdt,
    totalExecutionCostUsdt: operatorReport.costs.totalCostUsdt,
    terminalEquityUsdt: operatorReport.capital.finalEquityUsdt,
    profitabilityObserved: compareDecimal(operatorReport.returns.netPnlUsdt, "0") !== 0,
  };
  assertFhvPnlReportV1(report);
  return report;
}

export function reconcileFhvPnlReportWithEvents(
  report: FhvPnlReportV1,
  events: FhvReportBuildInput["semanticEvents"],
): boolean {
  return report.semanticEventsDigest === buildSemanticEventsDigest(events);
}

export function deriveFhvPnlFromOperatorCapital(
  initialEquityUsdt: string,
  finalEquityUsdt: string,
  totalExecutionCostUsdt = "0",
): { grossPnlUsdt: string; netPnlUsdt: string } {
  const grossPnlUsdt = subtractDecimal(finalEquityUsdt, initialEquityUsdt);
  const netPnlUsdt = subtractDecimal(grossPnlUsdt, totalExecutionCostUsdt);
  return { grossPnlUsdt, netPnlUsdt };
}
