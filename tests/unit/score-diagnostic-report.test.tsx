import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScoreDiagnosticReport } from "@/components/trader/admin/score-diagnostic-report";
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

  it("marks a loaded report as qualification NOT_RUN", () => {
    render(
      <ScoreDiagnosticReport
        report={{
          format: "waia-scientific-score-diagnostic/v1",
          qualification: "NOT_RUN",
          authorityGranted: false,
          forecastCount: 12,
        }}
      />,
    );
    expect(screen.getByText("qualification: NOT_RUN")).toBeTruthy();
    expect(screen.getByText("Saved forecast count: 12")).toBeTruthy();
    expect(screen.queryByText(/PASS/)).toBeNull();
  });

  it("does not render a report that claims qualification authority", () => {
    render(
      <ScoreDiagnosticReport
        report={{
          format: "waia-scientific-score-diagnostic/v1",
          qualification: "PASS",
          authorityGranted: true,
          forecastCount: 12,
        }}
      />,
    );
    expect(screen.getByText("qualification: NOT_RUN")).toBeTruthy();
    expect(screen.getByText(/unavailable/)).toBeTruthy();
    expect(screen.queryByText("Saved forecast count: 12")).toBeNull();
  });
});
