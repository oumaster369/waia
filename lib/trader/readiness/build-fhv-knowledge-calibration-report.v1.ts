import {
  assertFhvKnowledgeAndCalibrationReportV1,
  FHV_KNOWLEDGE_AND_CALIBRATION_REPORT_KIND,
  FHV_KNOWLEDGE_AND_CALIBRATION_REPORT_SCHEMA_VERSION,
  type FhvKnowledgeAndCalibrationReportV1,
} from "@/lib/trader/readiness/htr-operator-report-schema.v1";
import {
  buildSemanticEventsDigest,
  type FhvReportBuildInput,
} from "@/lib/trader/readiness/build-htr-operator-report.v1";

export type BuildFhvKnowledgeAndCalibrationReportInputV1 = FhvReportBuildInput;

export function buildFhvKnowledgeAndCalibrationReportV1(
  input: BuildFhvKnowledgeAndCalibrationReportInputV1,
): FhvKnowledgeAndCalibrationReportV1 {
  const calibrationEvents = input.semanticEvents.filter(
    (event) => event.moduleName.includes("calibration") || event.eventType.includes("CALIBRATION"),
  );
  const knowledgeEvents = input.semanticEvents.filter(
    (event) =>
      event.moduleName.includes("knowledge") ||
      event.moduleName.includes("outcome") ||
      event.eventType.includes("KNOWLEDGE"),
  );

  const report: FhvKnowledgeAndCalibrationReportV1 = {
    reportKind: FHV_KNOWLEDGE_AND_CALIBRATION_REPORT_KIND,
    schemaVersion: FHV_KNOWLEDGE_AND_CALIBRATION_REPORT_SCHEMA_VERSION,
    reportId: input.reportId,
    runId: input.runId,
    organizationId: input.organizationId,
    accountKey: input.accountKey,
    generatedAtUtc: input.generatedAtUtc,
    semanticEventsDigest: buildSemanticEventsDigest(input.semanticEvents),
    eventCount: input.semanticEvents.length,
    calibrationEventCount: calibrationEvents.length,
    knowledgeUpdateEventCount: knowledgeEvents.length,
    epistemicClosureObserved: input.semanticEvents.some((event) =>
      event.eventType.includes("EPISTEMIC_CLOSURE"),
    ),
  };

  assertFhvKnowledgeAndCalibrationReportV1(report);
  return report;
}
