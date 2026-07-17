import { describe, expect, it } from "vitest";

import {
  evaluateHtrWp22CrashRecoveryMatrix,
  HTR_WP22_CRASH_RECOVERY_MATRIX_SCHEMA,
  runHtrWp22CrashRecoveryMatrix,
} from "@/lib/trader/backtest/htr-wp22-crash-recovery-matrix";

describe("HTR-WP22 crash recovery matrix", () => {
  it("declares schema version", () => {
    expect(HTR_WP22_CRASH_RECOVERY_MATRIX_SCHEMA).toBe("htr-wp22-crash-recovery-matrix/v1");
  });

  it("runs upstream WP04 recovery harness and reports matrix cases", async () => {
    const result = await runHtrWp22CrashRecoveryMatrix();
    expect(result.matrix.length).toBeGreaterThanOrEqual(4);
    expect(result.matrix.every((entry) => typeof entry.caseId === "string")).toBe(true);
    expect(["HTR_WP22_CRASH_RECOVERY_PASS", "HTR_WP22_CRASH_RECOVERY_FAIL"]).toContain(
      result.terminalState,
    );
    expect(typeof result.payloadSha256).toBe("string");
    expect(evaluateHtrWp22CrashRecoveryMatrix(result)).toBe(
      result.terminalState === "HTR_WP22_CRASH_RECOVERY_PASS",
    );
  }, 240_000);
});
