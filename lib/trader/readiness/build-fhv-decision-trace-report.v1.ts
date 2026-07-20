import {
  assertFhvDecisionTraceReportV1,
  FHV_DECISION_TRACE_REPORT_KIND,
  FHV_DECISION_TRACE_REPORT_SCHEMA_VERSION,
  type FhvDecisionTraceReportV1,
} from "@/lib/trader/readiness/htr-operator-report-schema.v1";
import {
  buildSemanticEventsDigest,
  type FhvReportBuildInput,
} from "@/lib/trader/readiness/build-htr-operator-report.v1";

export type BuildFhvDecisionTraceReportInputV1 = FhvReportBuildInput;

const DECISION_MODULE_NAMES = new Set([
  "paper-cycle",
  "forecast-decision",
  "guardian",
  "intelligence",
]);

export function buildFhvDecisionTraceReportV1(
  input: BuildFhvDecisionTraceReportInputV1,
): FhvDecisionTraceReportV1 {
  const decisionEvents = input.semanticEvents
    .filter(
      (event) =>
        DECISION_MODULE_NAMES.has(event.moduleName) ||
        event.eventType.includes("DECISION") ||
        event.eventType.includes("CYCLE"),
    )
    .map((event) => ({
      cycleId: event.cycleId,
      eventType: event.eventType,
      inputDigest: event.inputDigest,
      outputDigest: event.outputDigest,
      correlationId: event.correlationId,
    }));

  const report: FhvDecisionTraceReportV1 = {
    reportKind: FHV_DECISION_TRACE_REPORT_KIND,
    schemaVersion: FHV_DECISION_TRACE_REPORT_SCHEMA_VERSION,
    reportId: input.reportId,
    runId: input.runId,
    organizationId: input.organizationId,
    accountKey: input.accountKey,
    generatedAtUtc: input.generatedAtUtc,
    semanticEventsDigest: buildSemanticEventsDigest(input.semanticEvents),
    eventCount: input.semanticEvents.length,
    decisionEvents,
  };

  assertFhvDecisionTraceReportV1(report);
  return report;
}
