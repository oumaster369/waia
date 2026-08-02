/**
 * Phase 0/10 — in-process resume is not process-level crash/resume proof.
 */

import { describe, expect, it } from "vitest";

describe("FHV process boundary RED", () => {
  it("FHV_PROCESS_RESUME_IN_PROCESS_RED: two in-process calls are not process proof", () => {
    const inProcessResumeCalls = 2;
    const spawnedChildProcesses = 0;
    const classification =
      spawnedChildProcesses >= 2
        ? "FHV_PROCESS_CRASH_RESUME_PARITY_PASS"
        : "IN_PROCESS_RESUME_NOT_PROOF";
    expect(classification).toBe("IN_PROCESS_RESUME_NOT_PROOF");
    expect(inProcessResumeCalls).toBeGreaterThan(0);
    expect(spawnedChildProcesses).toBe(0);
  });
});
