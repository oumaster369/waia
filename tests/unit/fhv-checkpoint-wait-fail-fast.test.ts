import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  advanceFhvLaunchJournal,
  buildFhvLaunchJournal,
  writeFhvLaunchJournalAtomic,
} from "@/lib/trader/observability/fhv-launch-journal";
import {
  FhvOfficialScaleChildExitedError,
  waitForFhvOfficialScaleCheckpoint,
} from "@/tests/fhv/official-scale/blocking/fhv-official-scale-harness";

/**
 * Process-parity fail-fast (WP-3B corrective pass).
 *
 * The harness previously polled only the filesystem, so a child that died in its first second
 * still consumed the full 1,800,000 ms timeout and then reported `expected 1 to be 0` with no
 * stdout, stderr, exit code or signal. Racing the child's termination against checkpoint readiness
 * turns that into an immediate, diagnosable failure.
 */

const roots: string[] = [];

function makeRunDir(): string {
  const root = mkdtempSync(join(tmpdir(), "fhv-wait-fail-fast-"));
  roots.push(root);
  mkdirSync(join(root, "run"), { recursive: true });
  return join(root, "run");
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("FHV checkpoint wait fail-fast", () => {
  it("fails promptly with full diagnostics when the child dies before checkpointing", async () => {
    const runDir = makeRunDir();
    const startedAt = Date.now();

    const error = await waitForFhvOfficialScaleCheckpoint({
      runDir,
      lastCommittedCycle: 4508,
      // The production timeout is unchanged; the point is that we never approach it.
      timeoutMs: 1_800_000,
      runId: "fhv-official-scale-crash",
      pollIntervalMs: 10,
      child: {
        promise: Promise.resolve({
          exitCode: 1,
          signal: null,
          stdout: "partial stdout before crash",
          stderr: "FHV_LAUNCH_FAILED: dataset qualification receipt rejected",
        }),
      },
    }).then(
      () => null,
      (caught: unknown) => caught as FhvOfficialScaleChildExitedError,
    );
    const elapsedMs = Date.now() - startedAt;

    expect(error).toBeInstanceOf(FhvOfficialScaleChildExitedError);
    expect(error!.detail.runId).toBe("fhv-official-scale-crash");
    expect(error!.detail.expectedCycle).toBe(4508);
    expect(error!.detail.exitCode).toBe(1);
    expect(error!.detail.signal).toBeNull();
    expect(error!.message).toContain("partial stdout before crash");
    expect(error!.message).toContain("dataset qualification receipt rejected");
    // Bounded failure: nowhere near the 30-minute production timeout.
    expect(elapsedMs).toBeLessThan(5_000);
  });

  it("returns the checkpoint when the child checkpoints and then exits normally", async () => {
    const runDir = makeRunDir();
    // Written through the canonical journal writer so the digest binding is genuine.
    writeFhvLaunchJournalAtomic(
      runDir,
      buildFhvLaunchJournal({ runId: "fhv-official-scale-crash", walPath: "wal" }),
    );
    advanceFhvLaunchJournal({
      runRoot: runDir,
      lastCommittedEpoch: 0,
      lastCommittedCycle: 4508,
      lastEpochCommitDigest: "a".repeat(64),
    });
    const checkpointDir = join(runDir, "checkpoints", "epoch-0");
    mkdirSync(checkpointDir, { recursive: true });
    writeFileSync(join(checkpointDir, ".ready"), "", "utf8");

    // A bounded child legitimately exits PAUSED right after checkpointing; that is not a crash.
    const observed = await waitForFhvOfficialScaleCheckpoint({
      runDir,
      lastCommittedCycle: 4508,
      timeoutMs: 30_000,
      pollIntervalMs: 10,
      child: {
        promise: Promise.resolve({
          exitCode: 0,
          signal: null,
          stdout: "FHV_SYNTHETIC_PROCESS_PARITY_PAUSED",
          stderr: "",
        }),
      },
    });

    expect(observed.lastCommittedCycle).toBe(4508);
  });

  it("preserves ordinary timeout semantics while the child is still running", async () => {
    const runDir = makeRunDir();
    const startedAt = Date.now();

    // A child that never resolves stands in for one still working. The bounded timeout here is a
    // test seam; the production call site still passes 1,800,000 ms.
    await expect(
      waitForFhvOfficialScaleCheckpoint({
        runDir,
        lastCommittedCycle: 4508,
        timeoutMs: 300,
        pollIntervalMs: 10,
        child: { promise: new Promise(() => {}) },
      }),
    ).rejects.toThrow(/timed out waiting for checkpoint/);

    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });
});
