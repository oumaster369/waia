import { describe, expect, it } from "vitest";

import {
  computePeakEquityDrawdownBps,
  evaluateDrawdownPolicy,
  isDrawdownBreach,
  resolveMonthKeyUtc,
  updateDrawdownHighWaterMarks,
} from "@/lib/trader/risk/drawdown-policy-evaluator";

describe("HTR-WP16 drawdown arithmetic", () => {
  it("treats equality at account limit as breach", () => {
    expect(isDrawdownBreach(2500, 2500)).toBe(true);
    expect(isDrawdownBreach(2499, 2500)).toBe(false);
    expect(isDrawdownBreach(2501, 2500)).toBe(true);
  });

  it("computes 25% account drawdown at 100000 peak", () => {
    expect(computePeakEquityDrawdownBps("75000", "100000")).toBe(2500);
    const evalResult = evaluateDrawdownPolicy({
      equityUsdt: "75000",
      accountPeakHwm: "100000",
      monthlyPeakHwm: "100000",
    });
    expect(evalResult.accountBreached).toBe(true);
    expect(evalResult.breachState).toBe("STOP_ACCOUNT");
  });

  it("initializes monthly HWM on UTC month transition only", () => {
    const updated = updateDrawdownHighWaterMarks({
      equityUsdt: "90000",
      accountPeakHwm: "100000",
      monthlyPeakHwm: "100000",
      priorMonthKey: "2026-01",
      monthKey: "2026-02",
    });
    expect(updated.accountPeakHwm).toBe("100000");
    expect(updated.monthlyPeakHwm).toBe("90000");
    expect(resolveMonthKeyUtc("2026-02-15T12:00:00.000Z")).toBe("2026-02");
  });
});
