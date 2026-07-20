import {
  assertFhvExecutionAndPositionReportV1,
  FHV_EXECUTION_AND_POSITION_REPORT_KIND,
  FHV_EXECUTION_AND_POSITION_REPORT_SCHEMA_VERSION,
  type FhvExecutionAndPositionReportV1,
} from "@/lib/trader/readiness/htr-operator-report-schema.v1";
import {
  buildSemanticEventsDigest,
  type FhvReportBuildInput,
} from "@/lib/trader/readiness/build-htr-operator-report.v1";

export type BuildFhvExecutionAndPositionReportInputV1 = FhvReportBuildInput;

export function buildFhvExecutionAndPositionReportV1(
  input: BuildFhvExecutionAndPositionReportInputV1,
): FhvExecutionAndPositionReportV1 {
  const executionEvents = input.semanticEvents.filter(
    (event) =>
      event.moduleName.includes("execution") ||
      event.eventType.includes("EXECUTION") ||
      event.eventType.includes("FILL"),
  );
  const positionEvents = input.semanticEvents.filter(
    (event) =>
      event.moduleName.includes("position") ||
      event.moduleName.includes("accounting") ||
      event.eventType.includes("POSITION"),
  );
  const cycleIds = [...new Set(input.semanticEvents.map((event) => event.cycleId))].sort();

  const report: FhvExecutionAndPositionReportV1 = {
    reportKind: FHV_EXECUTION_AND_POSITION_REPORT_KIND,
    schemaVersion: FHV_EXECUTION_AND_POSITION_REPORT_SCHEMA_VERSION,
    reportId: input.reportId,
    runId: input.runId,
    organizationId: input.organizationId,
    accountKey: input.accountKey,
    generatedAtUtc: input.generatedAtUtc,
    semanticEventsDigest: buildSemanticEventsDigest(input.semanticEvents),
    eventCount: input.semanticEvents.length,
    executionEventCount: executionEvents.length,
    positionEventCount: positionEvents.length,
    cycleIds,
  };

  assertFhvExecutionAndPositionReportV1(report);
  return report;
}
