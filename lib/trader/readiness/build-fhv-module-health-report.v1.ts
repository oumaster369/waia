import {
  assertFhvModuleHealthReportV1,
  FHV_MODULE_HEALTH_REPORT_KIND,
  FHV_MODULE_HEALTH_REPORT_SCHEMA_VERSION,
  type FhvModuleHealthReportV1,
} from "@/lib/trader/readiness/htr-operator-report-schema.v1";
import {
  buildSemanticEventsDigest,
  type FhvReportBuildInput,
} from "@/lib/trader/readiness/build-htr-operator-report.v1";

export type BuildFhvModuleHealthReportInputV1 = FhvReportBuildInput;

function isErrorEvent(eventType: string): boolean {
  return eventType.includes("ERROR") || eventType.includes("FAIL");
}

function isDegradedEvent(eventType: string): boolean {
  return eventType.includes("DEGRADED") || eventType.includes("PARTIAL");
}

export function buildFhvModuleHealthReportV1(
  input: BuildFhvModuleHealthReportInputV1,
): FhvModuleHealthReportV1 {
  const grouped = new Map<
    string,
    {
      moduleName: string;
      moduleVersion: string;
      eventCount: number;
      errorEventCount: number;
      degradedEventCount: number;
    }
  >();

  for (const event of input.semanticEvents) {
    const key = `${event.moduleName}@${event.moduleVersion}`;
    const current = grouped.get(key) ?? {
      moduleName: event.moduleName,
      moduleVersion: event.moduleVersion,
      eventCount: 0,
      errorEventCount: 0,
      degradedEventCount: 0,
    };
    current.eventCount += 1;
    if (isErrorEvent(event.eventType)) {
      current.errorEventCount += 1;
    }
    if (isDegradedEvent(event.eventType)) {
      current.degradedEventCount += 1;
    }
    grouped.set(key, current);
  }

  const moduleSummaries = [...grouped.values()]
    .sort((left, right) => left.moduleName.localeCompare(right.moduleName))
    .map((summary) => ({
      ...summary,
      healthyByEvidence: summary.errorEventCount === 0 && summary.degradedEventCount === 0,
    }));

  const report: FhvModuleHealthReportV1 = {
    reportKind: FHV_MODULE_HEALTH_REPORT_KIND,
    schemaVersion: FHV_MODULE_HEALTH_REPORT_SCHEMA_VERSION,
    reportId: input.reportId,
    runId: input.runId,
    organizationId: input.organizationId,
    accountKey: input.accountKey,
    generatedAtUtc: input.generatedAtUtc,
    semanticEventsDigest: buildSemanticEventsDigest(input.semanticEvents),
    eventCount: input.semanticEvents.length,
    moduleSummaries,
    overallHealthyByEvidence: moduleSummaries.every((summary) => summary.healthyByEvidence),
  };

  assertFhvModuleHealthReportV1(report);
  return report;
}

export function moduleHealthIndependentOfProfitability(
  report: FhvModuleHealthReportV1,
  netPnlPositive: boolean,
): boolean {
  if (netPnlPositive && !report.overallHealthyByEvidence) {
    return true;
  }
  if (netPnlPositive && report.overallHealthyByEvidence) {
    return report.moduleSummaries.every((summary) => summary.eventCount > 0);
  }
  return true;
}
