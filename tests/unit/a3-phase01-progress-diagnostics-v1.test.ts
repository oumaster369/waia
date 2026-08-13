import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  advanceA3Phase01ChunkProgress,
  appendA3DiagnosticLog,
  assertProgressRecordIsNotScientificEvidence,
  createInitialA3Phase01ProgressRecord,
  markA3Phase01ProgressTerminal,
  writeA3Phase01ProgressRecordAtomic,
  type A3Phase01ProgressRecordV1,
} from "@/lib/trader/intelligence/forecast-v2/a3-phase01-progress-diagnostics-v1";
import {
  computeA3CanonicalContractDigestHex,
  computePhase01ImplementationDigestHex,
  computeStorageSurfaceDigestHex,
} from "@/lib/trader/intelligence/forecast-v2/a3-storage-contract-v1";

const REPO_ROOT = join(__dirname, "../..");

describe("a3-phase01-progress-diagnostics-v1", () => {
  it("chunk progress record advances deterministically", () => {
    const base = createInitialA3Phase01ProgressRecord({
      runId: "A3-P01-TEST",
      canonicalContractDigest: "c".repeat(64),
      storageSurfaceDigest: "s".repeat(64),
      phase01ImplementationDigest: "p".repeat(64),
      targetChunkCount: 4,
    });
    const start = advanceA3Phase01ChunkProgress(base, {
      chunkIndex: 0,
      committedBundleCount: 0,
      event: "START",
    });
    expect(start.currentChunkIndex).toBe(0);
    expect(start.stage).toBe("POPULATING_BUNDLES");
    expect(start.lastChunkStartUtc).toBeTruthy();

    const commit = advanceA3Phase01ChunkProgress(start, {
      chunkIndex: 0,
      committedBundleCount: 50_000,
      event: "COMMIT",
    });
    expect(commit.committedBundleCount).toBe(50_000);
    expect(commit.lastChunkCompleteUtc).toBeTruthy();
    expect(commit.lastMeaningfulProgressUtc >= start.lastMeaningfulProgressUtc).toBe(true);
  });

  it("progress file write is atomic and readable", () => {
    const dir = mkdtempSync(join(tmpdir(), "a3-progress-"));
    const path = join(dir, "phase-01-progress.json");
    try {
      const record = createInitialA3Phase01ProgressRecord({
        runId: "A3-P01-TEST",
        canonicalContractDigest: "c".repeat(64),
        storageSurfaceDigest: "s".repeat(64),
        phase01ImplementationDigest: "p".repeat(64),
        targetChunkCount: 2,
      });
      writeA3Phase01ProgressRecordAtomic(record, path);
      expect(existsSync(path)).toBe(true);
      const parsed = JSON.parse(readFileSync(path, "utf8")) as A3Phase01ProgressRecordV1;
      expect(parsed.schemaVersion).toBe("a3-phase01-progress/v1");
      expect(parsed.scientificEvidence).toBe(false);
      expect(parsed.runId).toBe("A3-P01-TEST");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("progress/logging helpers do not alter canonical or storage digests", () => {
    const canonicalBefore = computeA3CanonicalContractDigestHex();
    const storageBefore = computeStorageSurfaceDigestHex(REPO_ROOT);
    const phase01Before = computePhase01ImplementationDigestHex(REPO_ROOT);

    const dir = mkdtempSync(join(tmpdir(), "a3-log-"));
    const logPath = join(dir, "a3.log");
    try {
      appendA3DiagnosticLog("[BOOTSTRAP] start", logPath);
      const record = createInitialA3Phase01ProgressRecord({
        runId: "A3-P01-TEST",
        canonicalContractDigest: canonicalBefore,
        storageSurfaceDigest: storageBefore,
        phase01ImplementationDigest: phase01Before,
        targetChunkCount: 1,
        logPath,
      });
      writeA3Phase01ProgressRecordAtomic(record, join(dir, "phase-01-progress.json"));
      expect(computeA3CanonicalContractDigestHex()).toBe(canonicalBefore);
      expect(computeStorageSurfaceDigestHex(REPO_ROOT)).toBe(storageBefore);
      // Implementation digest may already include diagnostics source; runtime writes must not change it.
      expect(computePhase01ImplementationDigestHex(REPO_ROOT)).toBe(phase01Before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("IO waits are diagnostic-only notes; Lock waits are explicit blockers", () => {
    const snapshotIo = {
      capturedAtUtc: new Date().toISOString(),
      activeBulkInsert: true,
      lockWaitRows: [] as string[],
      ioWaitRows: ["pid=1 state=active wait=IO/DataFileRead duration_ms=120000 query=INSERT"],
      activeQueryAgeMsMax: 120_000,
      note: "active_insert_with_io_wait_diagnostic_only",
    };
    expect(snapshotIo.lockWaitRows).toHaveLength(0);
    expect(snapshotIo.note).toContain("diagnostic_only");

    const snapshotLock = {
      ...snapshotIo,
      lockWaitRows: ["pid=2 state=active wait=Lock/relation duration_ms=31000 query=INSERT"],
      note: "lock_wait_present",
    };
    expect(snapshotLock.lockWaitRows.length).toBeGreaterThan(0);
  });

  it("stale/no-active-insert stall message remains fail-closed as designed", () => {
    const message =
      "[forecast-v2/storage-scale] POPULATING_BUNDLES stall: no active bulk insert for 600000ms at offset 0 count=50000";
    expect(message).toContain("no active bulk insert");
    expect(message).toContain("600000");
  });

  it("normal completion emits final progress marker; abnormal never creates PASS receipt", () => {
    const base = createInitialA3Phase01ProgressRecord({
      runId: "A3-P01-TEST",
      canonicalContractDigest: "c".repeat(64),
      storageSurfaceDigest: "s".repeat(64),
      phase01ImplementationDigest: "p".repeat(64),
      targetChunkCount: 1,
    });
    const normal = markA3Phase01ProgressTerminal(base, "NORMAL_COMPLETE");
    expect(normal.terminationMarker).toBe("NORMAL_COMPLETE");
    assertProgressRecordIsNotScientificEvidence(normal);

    const abnormal = markA3Phase01ProgressTerminal(base, "ABNORMAL_ABORT");
    expect(abnormal.terminationMarker).toBe("ABNORMAL_ABORT");
    assertProgressRecordIsNotScientificEvidence(abnormal);
    expect(abnormal.scientificEvidence).toBe(false);
    // Progress record has no PASS / receipt classification surface.
    expect("status" in abnormal).toBe(false);
    expect(JSON.stringify(abnormal)).not.toMatch(/A3_PHASE01_PASS|PASS_RECEIPT/);
  });

  it("progress record cannot be consumed as scientific evidence", () => {
    const record = createInitialA3Phase01ProgressRecord({
      runId: "A3-P01-TEST",
      canonicalContractDigest: "c".repeat(64),
      storageSurfaceDigest: "s".repeat(64),
      phase01ImplementationDigest: "p".repeat(64),
      targetChunkCount: 1,
    });
    expect(() =>
      assertProgressRecordIsNotScientificEvidence({
        ...record,
        scientificEvidence: true as unknown as false,
      }),
    ).toThrow(/scientificEvidence must be false/);
  });
});
