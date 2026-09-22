import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  loadScoreDiagnosticArtifact,
  ScoreDiagnosticReport,
} from "@/components/trader/admin/score-diagnostic-report";
import {
  parseScoreDiagnosticBindingV1,
  runScoreDiagnosticCliV1,
} from "../../scripts/trader/scientific-score-diagnostic-v1";

const HEX64 = "a".repeat(64);

describe("score diagnostic report", () => {
  it("rejects a binding that is not a wf-predictive comparison", () => {
    expect(() =>
      parseScoreDiagnosticBindingV1({
        packageKey: HEX64,
        releaseSha: "b".repeat(40),
        contentDigestHex: HEX64,
        developmentDatasetDigestHex: HEX64,
        evaluationPartitionReceiptDigestHex: HEX64,
        comparisonFamilyId: "not-a-family",
        forecastCount: 1,
        originalCompletedTrialIds: [HEX64],
      }),
    ).toThrow("SCIENTIFIC_SCORE_DIAGNOSTIC_REFUSED");
  });

  it("accepts a structurally valid binding", () => {
    const binding = parseScoreDiagnosticBindingV1({
      packageKey: HEX64,
      releaseSha: "b".repeat(40),
      contentDigestHex: HEX64,
      developmentDatasetDigestHex: HEX64,
      evaluationPartitionReceiptDigestHex: HEX64,
      comparisonFamilyId: "wf-predictive:btcusdt-30",
      forecastCount: 1,
      originalCompletedTrialIds: [HEX64],
    });
    expect(binding.forecastCount).toBe(1);
  });

  it("refuses the wrong CLI arity", () => {
    expect(runScoreDiagnosticCliV1(["--root", "/tmp/checkpoints"])).toBe(64);
  });

  it("shows a readable NOT_RUN report", () => {
    const artifact = loadScoreDiagnosticArtifact("/tmp/report.json", () =>
      JSON.stringify({
        format: "waia-scientific-score-diagnostic/v1",
        qualification: "NOT_RUN",
        authorityGranted: false,
        forecastCount: 12,
      }),
    );
    expect(artifact.state).toBe("report");
    render(<ScoreDiagnosticReport artifact={artifact} />);
    expect(screen.getByText("qualification: NOT_RUN")).toBeTruthy();
    expect(screen.getByText("Saved forecast count: 12")).toBeTruthy();
    expect(screen.queryByText(/PASS/)).toBeNull();
  });

  it("says the report is absent when no path is configured", () => {
    const artifact = loadScoreDiagnosticArtifact(undefined, () => {
      throw new Error("must not read");
    });
    expect(artifact).toEqual({
      state: "absent",
      source: "WAIA_SCORE_DIAGNOSTIC_REPORT_PATH",
    });
    render(<ScoreDiagnosticReport artifact={artifact} />);
    expect(screen.getByText(/Diagnostic report is absent/)).toBeTruthy();
  });

  it("says the report cannot be read when it claims qualification authority", () => {
    const artifact = loadScoreDiagnosticArtifact("/tmp/report.json", () =>
      JSON.stringify({
        format: "waia-scientific-score-diagnostic/v1",
        qualification: "PASS",
        authorityGranted: true,
        forecastCount: 12,
      }),
    );
    expect(artifact.state).toBe("unreadable");
    render(<ScoreDiagnosticReport artifact={artifact} />);
    expect(screen.getByText(/could not be read/)).toBeTruthy();
    expect(screen.queryByText("Saved forecast count: 12")).toBeNull();
  });
});
