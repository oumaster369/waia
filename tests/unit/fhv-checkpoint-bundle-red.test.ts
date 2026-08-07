import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FHV_CHECKPOINT_READY_MARKER,
  FhvExecutionCheckpointBundleError,
  publishFhvExecutionCheckpointBundle,
  readFhvExecutionCheckpointBundle,
  resolveFhvEpochCheckpointDir,
} from "@/lib/trader/observability/fhv-execution-checkpoint-bundle";

describe("FHV execution checkpoint bundle (Phase 4)", () => {
  let runRoot = "";

  afterEach(() => {
    if (runRoot) {
      rmSync(runRoot, { recursive: true, force: true });
      runRoot = "";
    }
  });

  it("FHV_CHECKPOINT_BUNDLE_ATOMIC_PUBLISH_PASS: publishes .ready-gated epoch directory", () => {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-checkpoint-bundle-"));
    const published = publishFhvExecutionCheckpointBundle({
      runDir: runRoot,
      runId: "fhv-checkpoint-run",
      epochId: 0,
      generation: 1,
      firstCycle: 0,
      lastCycle: 4,
      files: {
        "source-cursor.v2.json": '{"cursor":1}',
        "execution-frontier.v2.json": '{"frontier":1}',
      },
      sourceCursorDigest: "a".repeat(64),
      executionStateDigest: "b".repeat(64),
      accountingFrontierDigest: "c".repeat(64),
      identityFrontierDigest: "d".repeat(64),
      evidenceFrontierDigest: "e".repeat(64),
      sessionDatabaseDigest: "f".repeat(64),
    });

    expect(existsSync(join(published.checkpointDir, FHV_CHECKPOINT_READY_MARKER))).toBe(true);
    expect(published.checkpointRelativePath).toBe("checkpoints/epoch-0");
    expect(published.manifest.lastCycle).toBe(4);

    const reread = readFhvExecutionCheckpointBundle(published.checkpointDir);
    expect(reread.manifest.checkpointContentDigest).toBe(
      published.manifest.checkpointContentDigest,
    );
    expect(readFileSync(join(published.checkpointDir, "source-cursor.v2.json"), "utf8")).toContain(
      '"cursor":1',
    );
  });

  it("FHV_CHECKPOINT_BUNDLE_READY_REQUIRED_PASS: rejects bundle without .ready", () => {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-checkpoint-no-ready-"));
    const checkpointDir = resolveFhvEpochCheckpointDir(runRoot, 1);
    publishFhvExecutionCheckpointBundle({
      runDir: runRoot,
      runId: "fhv-checkpoint-run",
      epochId: 1,
      generation: 1,
      firstCycle: 5,
      lastCycle: 9,
      files: { "rate-store.v2.json": "{}" },
      sourceCursorDigest: "1".repeat(64),
      executionStateDigest: "2".repeat(64),
      accountingFrontierDigest: "3".repeat(64),
      identityFrontierDigest: "4".repeat(64),
      evidenceFrontierDigest: "5".repeat(64),
      sessionDatabaseDigest: "6".repeat(64),
    });

    rmSync(join(checkpointDir, FHV_CHECKPOINT_READY_MARKER));
    expect(() => readFhvExecutionCheckpointBundle(checkpointDir)).toThrow(
      FhvExecutionCheckpointBundleError,
    );
  });

  it("FHV_CHECKPOINT_BUNDLE_EPOCH_EXISTS_PASS: fails closed on duplicate epoch directory", () => {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-checkpoint-dup-"));
    const baseInput = {
      runDir: runRoot,
      runId: "fhv-checkpoint-run",
      epochId: 2,
      generation: 1,
      firstCycle: 0,
      lastCycle: 2,
      files: { "rate-store.v2.json": "{}" },
      sourceCursorDigest: "1".repeat(64),
      executionStateDigest: "2".repeat(64),
      accountingFrontierDigest: "3".repeat(64),
      identityFrontierDigest: "4".repeat(64),
      evidenceFrontierDigest: "5".repeat(64),
      sessionDatabaseDigest: "6".repeat(64),
    } as const;

    publishFhvExecutionCheckpointBundle(baseInput);
    expect(() => publishFhvExecutionCheckpointBundle(baseInput)).toThrow(
      FhvExecutionCheckpointBundleError,
    );
  });
});
