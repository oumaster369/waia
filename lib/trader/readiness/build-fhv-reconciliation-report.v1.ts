import {
  assertFhvReconciliationReportV1,
  FHV_RECONCILIATION_REPORT_KIND,
  FHV_RECONCILIATION_REPORT_SCHEMA_VERSION,
  type FhvReconciliationReportV1,
} from "@/lib/trader/readiness/htr-operator-report-schema.v1";
import {
  buildSemanticEventsDigest,
  type FhvReportBuildInput,
} from "@/lib/trader/readiness/build-htr-operator-report.v1";

export type BuildFhvReconciliationReportInputV1 = FhvReportBuildInput;

export function buildFhvReconciliationReportV1(
  input: BuildFhvReconciliationReportInputV1,
): FhvReconciliationReportV1 {
  const reconciliationEvents = input.semanticEvents.filter(
    (event) =>
      event.moduleName.includes("reconciliation") || event.eventType.includes("RECONCILIATION"),
  );
  const reconciliationFailures = reconciliationEvents.filter((event) =>
    event.eventType.includes("FAIL"),
  ).length;

  const report: FhvReconciliationReportV1 = {
    reportKind: FHV_RECONCILIATION_REPORT_KIND,
    schemaVersion: FHV_RECONCILIATION_REPORT_SCHEMA_VERSION,
    reportId: input.reportId,
    runId: input.runId,
    organizationId: input.organizationId,
    accountKey: input.accountKey,
    generatedAtUtc: input.generatedAtUtc,
    semanticEventsDigest: buildSemanticEventsDigest(input.semanticEvents),
    eventCount: input.semanticEvents.length,
    reconciliationEventCount: reconciliationEvents.length,
    reconciliationFailures,
    reconciled: reconciliationFailures === 0,
  };

  assertFhvReconciliationReportV1(report);
  return report;
}
