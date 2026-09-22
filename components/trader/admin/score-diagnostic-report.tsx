import { ReadReviewActionShell } from "@/components/trader/admin/read-review-action-shell";

export type ScoreDiagnosticReportView = Readonly<{
  format: "waia-scientific-score-diagnostic/v1";
  qualification: "NOT_RUN";
  authorityGranted: false;
  forecastCount: number;
}>;

export function readScoreDiagnosticReport(value: unknown): ScoreDiagnosticReportView | null {
  if (!value || typeof value !== "object") return null;
  const report = value as Partial<ScoreDiagnosticReportView>;
  const forecastCount = report.forecastCount;
  if (report.format !== "waia-scientific-score-diagnostic/v1") return null;
  if (report.qualification !== "NOT_RUN" || report.authorityGranted !== false) return null;
  if (
    typeof forecastCount !== "number" ||
    !Number.isSafeInteger(forecastCount) ||
    forecastCount < 0
  ) {
    return null;
  }
  return {
    format: report.format,
    qualification: "NOT_RUN",
    authorityGranted: false,
    forecastCount,
  };
}

export const SCORE_DIAGNOSTIC_REPORT_SOURCE = "WAIA_SCORE_DIAGNOSTIC_REPORT_PATH";

export type ScoreDiagnosticArtifact =
  | Readonly<{ state: "absent"; source: typeof SCORE_DIAGNOSTIC_REPORT_SOURCE }>
  | Readonly<{ state: "unreadable"; source: string }>
  | Readonly<{ state: "report"; source: string; report: ScoreDiagnosticReportView }>;

export function loadScoreDiagnosticArtifact(
  path: string | undefined,
  readFile: (filePath: string) => string,
): ScoreDiagnosticArtifact {
  if (!path?.trim()) return { state: "absent", source: SCORE_DIAGNOSTIC_REPORT_SOURCE };
  const source = path.trim();
  let text: string;
  try {
    text = readFile(source);
  } catch {
    return { state: "unreadable", source };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: "unreadable", source };
  }
  const report = readScoreDiagnosticReport(parsed);
  if (!report) return { state: "unreadable", source };
  return { state: "report", source, report };
}

export function ScoreDiagnosticReport({ artifact }: { artifact: ScoreDiagnosticArtifact }) {
  return (
    <ReadReviewActionShell
      title="Score diagnostic"
      readContent={
        <div className="space-y-2">
          <p className="text-waia-fg text-sm">qualification: NOT_RUN</p>
          <p className="text-waia-fg-muted text-sm">
            This is a diagnostic readout. It is not a qualification pass or fail.
          </p>
          {artifact.state === "absent" ? (
            <p className="text-waia-fg text-sm">
              Diagnostic report is absent. Source: {artifact.source}
            </p>
          ) : null}
          {artifact.state === "unreadable" ? (
            <p className="text-waia-fg text-sm">
              Diagnostic report could not be read. Source: {artifact.source}
            </p>
          ) : null}
          {artifact.state === "report" ? (
            <p className="text-waia-fg text-sm">
              Saved forecast count: {artifact.report.forecastCount}
            </p>
          ) : null}
        </div>
      }
    />
  );
}
