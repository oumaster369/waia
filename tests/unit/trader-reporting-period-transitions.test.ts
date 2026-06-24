import { describe, expect, it } from "vitest";

import {
  assertAllowedReportingPeriodTransition,
  isTerminalReportingPeriodStatus,
  REPORTING_PERIOD_TRANSITIONS,
  ReportingPeriodInvalidTransitionError,
} from "@/lib/trader/billing";

describe("reporting period lifecycle transitions (DEE-306 S2)", () => {
  it("allows OPEN to CLOSED", () => {
    expect(() => assertAllowedReportingPeriodTransition("OPEN", "CLOSED")).not.toThrow();
  });

  it("rejects CLOSED to OPEN", () => {
    expect(() => assertAllowedReportingPeriodTransition("CLOSED", "OPEN")).toThrow(
      ReportingPeriodInvalidTransitionError,
    );
  });

  it("rejects CLOSED to CLOSED", () => {
    expect(() => assertAllowedReportingPeriodTransition("CLOSED", "CLOSED")).toThrow(
      ReportingPeriodInvalidTransitionError,
    );
  });

  it("marks CLOSED as terminal", () => {
    expect(isTerminalReportingPeriodStatus("CLOSED")).toBe(true);
    expect(isTerminalReportingPeriodStatus("OPEN")).toBe(false);
  });

  it("exports transition table", () => {
    expect(REPORTING_PERIOD_TRANSITIONS.OPEN).toEqual(["CLOSED"]);
    expect(REPORTING_PERIOD_TRANSITIONS.CLOSED).toEqual([]);
  });
});
