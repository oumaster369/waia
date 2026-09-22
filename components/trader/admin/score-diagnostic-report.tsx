export type ScoreDiagnosticReportView = Readonly<{
  format: "waia-scientific-score-diagnostic/v1";
  qualification: "NOT_RUN";
  authorityGranted: false;
  forecastCount: number;
}>;

export function readScoreDiagnosticReport(value: unknown): ScoreDiagnosticReportView | null {
  if (!value || typeof value !== "object") return null;
  const report = value as Partial<ScoreDiagnosticReportView>;
  if (report.format !== "waia-scientific-score-diagnostic/v1") return null;
  if (report.qualification !== "NOT_RUN" || report.authorityGranted !== false) return null;
  if (!Number.isSafeInteger(report.forecastCount) || report.forecastCount < 0) return null;
  return {
    format: report.format,
    qualification: "NOT_RUN",
    authorityGranted: false,
    forecastCount: report.forecastCount,
  };
}

export function ScoreDiagnosticReport({ report }: { report: unknown }) {
  const parsed = readScoreDiagnosticReport(report);
  return (
    <section aria-label="Score diagnostic">
      <p>qualification: NOT_RUN</p>
      <p>This is a diagnostic readout. It is not a qualification pass or fail.</p>
      {parsed ? (
        <p>Saved forecast count: {parsed.forecastCount}</p>
      ) : (
        <p>Diagnostic report unavailable. No score was computed in this process.</p>
      )}
    </section>
  );
}
