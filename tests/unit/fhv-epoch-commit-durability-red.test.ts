import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { FHV_EXECUTION_PURPOSE_FULL_HISTORICAL } from "@/lib/trader/observability/fhv-execution-purpose";
import * as fhvExecutionWal from "@/lib/trader/observability/fhv-execution-wal";
import {
  computeEpochCommitDigest,
  FhvExecutionWalWriter,
  fsyncFhvExecutionWalFile,
  recoverFhvExecutionWalTail,
  type FhvEpochCommitRecord,
} from "@/lib/trader/observability/fhv-execution-wal";
import {
  advanceFhvLaunchJournalAtomic,
  buildFhvLaunchJournal,
  writeFhvLaunchJournalAtomic,
} from "@/lib/trader/observability/fhv-launch-journal";

describe("FHV epoch commit durability (Phase 2/4)", () => {
  let runRoot = "";

  afterEach(() => {
    vi.restoreAllMocks();
    if (runRoot) {
      rmSync(runRoot, { recursive: true, force: true });
      runRoot = "";
    }
  });

  it("FHV_WAL_FSYNC_AFTER_APPEND_PASS: WAL writer fsyncs after append", () => {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-wal-fsync-"));
    const fsyncSpy = vi.spyOn(fhvExecutionWal.fhvExecutionWalDurability, "fsyncAfterAppend");
    const writer = new FhvExecutionWalWriter(
      runRoot,
      "fhv-wal-fsync-run",
      FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
      1,
    );

    writer.appendRecord({
      epochId: 0,
      cycleIndex: 0,
      cycleCommitId: "fhv-wal-fsync-run:0:0:begin",
      recordType: "EPOCH_BEGIN",
      payload: { epochId: 0, firstCycle: 0 },
    });

    expect(fsyncSpy).toHaveBeenCalled();
    fsyncSpy.mockRestore();

    const walPath = writer.getWalPath();
    const { validRecords } = recoverFhvExecutionWalTail(walPath);
    expect(validRecords).toHaveLength(1);
    expect(validRecords[0]?.payload).toEqual({ epochId: 0, firstCycle: 0 });
  });

  it("FHV_WAL_DURABLE_ON_DISK_PASS: recovered WAL matches bytes after fsync helper", () => {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-wal-durable-"));
    const walPath = join(runRoot, "execution.wal.ndjson");
    writeFileSync(walPath, "", "utf8");

    const commitBody: Omit<FhvEpochCommitRecord, "epochCommitDigest"> = {
      firstCycle: 0,
      lastCycle: 4,
      walStartOffset: 0,
      walEndOffset: 128,
      recordCount: 1,
      sourceCursorDigest: "1".repeat(64),
      executionCheckpointDigest: "2".repeat(64),
      evidenceFrontier: "5",
      orderFillFrontier: "0".repeat(64),
      authorizationClaimDigest: "3".repeat(64),
      previousCommittedEpochDigest: "0".repeat(64),
    };
    const commitPayload: FhvEpochCommitRecord = {
      ...commitBody,
      epochCommitDigest: computeEpochCommitDigest(commitBody),
    };

    const writer = new FhvExecutionWalWriter(
      runRoot,
      "fhv-wal-durable-run",
      FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
      1,
    );
    writer.appendRecord({
      epochId: 0,
      cycleIndex: 4,
      cycleCommitId: "fhv-wal-durable-run:0:4:commit",
      recordType: "EPOCH_COMMIT",
      payload: commitPayload,
    });

    fsyncFhvExecutionWalFile(walPath);
    const onDisk = readFileSync(walPath, "utf8");
    const { validRecords } = recoverFhvExecutionWalTail(walPath);
    expect(validRecords).toHaveLength(1);
    expect(onDisk).toContain(JSON.stringify(commitPayload.epochCommitDigest));
    expect(validRecords[0]?.payload).toEqual(commitPayload);
  });

  it("FHV_LAUNCH_JOURNAL_ATOMIC_CAS_PASS: journal advance uses compare-and-replace", () => {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-journal-cas-"));
    const walPath = join(runRoot, "execution.wal.ndjson");
    writeFhvLaunchJournalAtomic(
      runRoot,
      buildFhvLaunchJournal({ runId: "fhv-journal-cas-run", walPath }),
    );

    const next = advanceFhvLaunchJournalAtomic({
      runRoot,
      lastCommittedEpoch: 0,
      lastCommittedCycle: 9,
      lastEpochCommitDigest: "e".repeat(64),
    });

    expect(next.lastCommittedEpoch).toBe(0);
    expect(next.lastCommittedCycle).toBe(9);
    expect(next.lastEpochCommitDigest).toBe("e".repeat(64));
  });
});
