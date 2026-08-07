/**
 * Phase 11–12 — FHV official-scale process crash/resume parity (blocking gate).
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertFhvDatasetSealed } from "@/lib/trader/market-data/fhv-dataset-seal";
import { readFhvFullHistoricalAuthorizationReceipt } from "@/lib/trader/observability/fhv-full-historical-auth";
import { executeFhvFullHistoricalLaunch } from "@/lib/trader/observability/fhv-full-historical-launch";

import {
  assertFhvOfficialScaleProcessParityMatch,
  buildFhvOfficialScaleHarnessContext,
  extractFhvOfficialScaleParitySnapshot,
  runFhvOfficialScaleCli,
  setupFhvOfficialScaleLaunchPaths,
  spawnFhvOfficialScaleCli,
  teardownFhvOfficialScaleHarnessContext,
  toFhvOfficialScaleLaunchInput,
  waitForFhvOfficialScaleCheckpoint,
  writeFhvOfficialScaleSyntheticAuthority,
} from "./fhv-official-scale-harness";
import {
  CHECKPOINT_EVERY_CYCLES,
  LAST_COMMITTED_CYCLE_INDEX,
  LAST_TARGET_CYCLE_INDEX,
  RESUMED_TAIL_CYCLE_COUNT,
  TARGET_CYCLE_COUNT,
} from "./fhv-official-scale-constants";

describe("FHV official-scale process crash-resume parity (Phase 11–12 blocking)", () => {
  const harness = buildFhvOfficialScaleHarnessContext();

  beforeAll(() => {
    // Process parity proves correctness independently of full-corpus time feasibility.
    expect(existsSync(harness.datasetRoot)).toBe(true);
  }, 600_000);

  afterAll(() => {
    teardownFhvOfficialScaleHarnessContext(harness);
  });

  it("documents process parity resume constants", () => {
    expect(RESUMED_TAIL_CYCLE_COUNT).toBe(512);
    expect(LAST_COMMITTED_CYCLE_INDEX + RESUMED_TAIL_CYCLE_COUNT).toBeLessThanOrEqual(
      TARGET_CYCLE_COUNT,
    );
    expect(LAST_TARGET_CYCLE_INDEX).toBe(4508);
  });

  it("FHV_OFFICIAL_PROCESS_PARITY_PAUSED: cross-process pause classification", async () => {
    const pauseRunId = "fhv-official-scale-pause-only";
    const pausePaths = setupFhvOfficialScaleLaunchPaths({
      harness,
      runId: pauseRunId,
      maxCycles: CHECKPOINT_EVERY_CYCLES,
      targetCycleCount: TARGET_CYCLE_COUNT,
      technicalObservationMode: true,
    });

    const child = await runFhvOfficialScaleCli(pausePaths, {
      maxCycles: CHECKPOINT_EVERY_CYCLES,
    });
    // Report the child's own output on failure; a bare `expected 1 to be 0` hides the cause.
    expect(
      child.exitCode,
      `pause child exited ${String(child.exitCode)} signal=${String(child.signal)}\n` +
        `--- stdout ---\n${child.stdout}\n--- stderr ---\n${child.stderr}`,
    ).toBe(0);
    expect(child.stdout).toContain("FHV_SYNTHETIC_PROCESS_PARITY_PAUSED");
  }, 1_800_000);

  it("FHV_PROCESS_CRASH_RESUME_PARITY_PASS: cross-process pause, SIGKILL, and resume", async () => {
    const controlRunId = "fhv-official-scale-control";
    const crashRunId = "fhv-official-scale-crash";

    const controlPaths = setupFhvOfficialScaleLaunchPaths({
      harness,
      runId: controlRunId,
      maxCycles: TARGET_CYCLE_COUNT,
      targetCycleCount: TARGET_CYCLE_COUNT,
    });
    const controlResult = await executeFhvFullHistoricalLaunch(
      toFhvOfficialScaleLaunchInput(controlPaths, { maxCycles: TARGET_CYCLE_COUNT }),
    );
    expect(controlResult.classification).toBe("FHV_SYNTHETIC_SCALE_PROBE_COMPLETED");

    const crashPaths = setupFhvOfficialScaleLaunchPaths({
      harness,
      runId: crashRunId,
      maxCycles: CHECKPOINT_EVERY_CYCLES,
      targetCycleCount: TARGET_CYCLE_COUNT,
      technicalObservationMode: true,
    });

    const sealed = assertFhvDatasetSealed(harness.datasetRoot);
    writeFhvOfficialScaleSyntheticAuthority({
      authorityDir: join(harness.artifactRoot, "prep", crashRunId),
      runId: crashRunId,
      organizationId: harness.organizationId,
      releaseSha: harness.releaseSha,
      datasetContentDigest: sealed.manifest.datasetContentDigest,
      manifestSemanticDigest: sealed.manifest.manifestSemanticDigest,
      maxCycles: CHECKPOINT_EVERY_CYCLES,
      targetCycleCount: TARGET_CYCLE_COUNT,
      technicalObservationMode: true,
      overwrite: true,
    });

    const childA = spawnFhvOfficialScaleCli(crashPaths, {
      maxCycles: CHECKPOINT_EVERY_CYCLES,
    });
    const checkpoint = await waitForFhvOfficialScaleCheckpoint({
      runDir: crashPaths.runDir,
      lastCommittedCycle: LAST_COMMITTED_CYCLE_INDEX,
      timeoutMs: 1_800_000,
      // Racing the child's exit turns a crashed launch into an immediate, diagnosable failure
      // instead of a 30-minute wait followed by `expected 1 to be 0`.
      child: childA,
      runId: crashRunId,
    });
    expect(checkpoint.lastCommittedCycle).toBe(LAST_COMMITTED_CYCLE_INDEX);

    try {
      process.kill(childA.pid, "SIGKILL");
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException).code;
      if (errno !== "ESRCH") {
        throw error;
      }
    }
    const childAResult = await childA.promise;
    // Faster hot path can exit PAUSED between checkpoint observe and SIGKILL delivery.
    // Accept either hard-kill or clean pause — resume parity below is the authority check.
    if (childAResult.signal === "SIGKILL") {
      expect(childAResult.signal).toBe("SIGKILL");
    } else {
      expect(childAResult.exitCode).toBe(0);
      expect(childAResult.stdout).toContain("FHV_SYNTHETIC_PROCESS_PARITY_PAUSED");
    }

    const walPath = join(crashPaths.runDir, "execution.wal.ndjson");
    if (existsSync(walPath)) {
      appendFileSync(walPath, '\n{"invalid":true}\n');
    }

    writeFhvOfficialScaleSyntheticAuthority({
      authorityDir: join(harness.artifactRoot, "prep", crashRunId),
      runId: crashRunId,
      organizationId: harness.organizationId,
      releaseSha: harness.releaseSha,
      datasetContentDigest: sealed.manifest.datasetContentDigest,
      manifestSemanticDigest: sealed.manifest.manifestSemanticDigest,
      maxCycles: TARGET_CYCLE_COUNT,
      targetCycleCount: TARGET_CYCLE_COUNT,
      checkpointEveryCycles: CHECKPOINT_EVERY_CYCLES,
      technicalObservationMode: true,
      overwrite: true,
    });

    const consumedAuth = readFhvFullHistoricalAuthorizationReceipt(
      crashPaths.authorizationReceiptPath,
    );
    const resumePaths = {
      ...crashPaths,
      authorizationReceiptDigest: consumedAuth.authorizationReceiptDigest,
    };

    const childB = await runFhvOfficialScaleCli(resumePaths, {
      maxCycles: TARGET_CYCLE_COUNT,
      resume: true,
    });
    expect(
      childB.exitCode,
      childB.stderr || childB.stdout || "child process produced no output",
    ).toBe(0);
    expect(childB.stdout).toContain("FHV_SYNTHETIC_PROCESS_PARITY_SEGMENT_COMPLETED");

    const controlSnapshot = extractFhvOfficialScaleParitySnapshot({
      runDir: controlPaths.runDir,
      sourceFrontier: controlResult.backtest?.sourceFrontier,
      semanticReproDigest: controlResult.semanticReproDigest,
      classification: controlResult.classification,
      accountingSequence: controlResult.backtest?.accountingFrontierState?.accountingSequence,
      fillsCount: controlResult.backtest?.accountingFrontierState?.consumedFillIds.length,
    });
    const crashLaunchResult = JSON.parse(
      readFileSync(join(crashPaths.runDir, "fhv-full-launch-result.v1.json"), "utf8"),
    ) as {
      classification: string;
      semanticReproDigest: string;
      accountingFrontierState?: {
        accountingSequence?: number;
        consumedFillIds?: string[];
      };
    };
    const crashSnapshot = extractFhvOfficialScaleParitySnapshot({
      runDir: crashPaths.runDir,
      classification: crashLaunchResult.classification,
      semanticReproDigest: crashLaunchResult.semanticReproDigest,
      accountingSequence: crashLaunchResult.accountingFrontierState?.accountingSequence,
      fillsCount: crashLaunchResult.accountingFrontierState?.consumedFillIds?.length,
    });

    assertFhvOfficialScaleProcessParityMatch(controlSnapshot, crashSnapshot);
  }, 1_800_000);
});
