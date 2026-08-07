import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FHV_EXECUTION_PURPOSE_FULL_HISTORICAL } from "@/lib/trader/observability/fhv-execution-purpose";
import {
  computeEpochCommitDigest,
  FhvExecutionWalError,
  FhvExecutionWalWriter,
  FHV_EXECUTION_WAL_FORMAT_VERSION,
  FHV_EXECUTION_WAL_RECORD_SCHEMA_VERSION,
  recoverFhvExecutionWalTail,
  validateFhvExecutionWalRecord,
  type FhvEpochCommitRecord,
} from "@/lib/trader/observability/fhv-execution-wal";

describe("FHV WAL typed payload (Phase 2/4)", () => {
  let runRoot = "";

  afterEach(() => {
    if (runRoot) {
      rmSync(runRoot, { recursive: true, force: true });
      runRoot = "";
    }
  });

  it("FHV_WAL_COMMIT_PAYLOAD_ROUNDTRIP_PASS: EPOCH_COMMIT payload survives append and recovery", () => {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-wal-payload-"));
    const runId = "fhv-wal-payload-roundtrip";
    const writer = new FhvExecutionWalWriter(
      runRoot,
      runId,
      FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
      1,
    );

    const commitBody: Omit<FhvEpochCommitRecord, "epochCommitDigest"> = {
      firstCycle: 0,
      lastCycle: 9,
      walStartOffset: 0,
      walEndOffset: 512,
      recordCount: 3,
      sourceCursorDigest: "a".repeat(64),
      executionCheckpointDigest: "b".repeat(64),
      evidenceFrontier: "10",
      orderFillFrontier: "0".repeat(64),
      authorizationClaimDigest: "c".repeat(64),
      previousCommittedEpochDigest: "0".repeat(64),
      checkpointRelativePath: "checkpoints/epoch-000000.json",
      sessionDatabaseDigest: "d".repeat(64),
    };
    const epochCommitDigest = computeEpochCommitDigest(commitBody);
    const commitPayload: FhvEpochCommitRecord = { ...commitBody, epochCommitDigest };

    const appended = writer.appendRecord({
      epochId: 0,
      cycleIndex: 9,
      cycleCommitId: `${runId}:0:9:commit`,
      recordType: "EPOCH_COMMIT",
      payload: commitPayload,
    });

    expect(appended.schemaVersion).toBe(FHV_EXECUTION_WAL_RECORD_SCHEMA_VERSION);
    expect(appended.walFormatVersion).toBe(FHV_EXECUTION_WAL_FORMAT_VERSION);
    expect(appended.payload).toEqual(commitPayload);
    validateFhvExecutionWalRecord(appended);

    const reopened = FhvExecutionWalWriter.openExisting({
      runRoot,
      runId,
      executionPurpose: FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
      fencingGeneration: 1,
    });
    expect(reopened.totalRecords).toBe(1);

    const { validRecords, truncatedTailBytes, rejectedV1Records } = recoverFhvExecutionWalTail(
      writer.getWalPath(),
    );
    expect(truncatedTailBytes).toBe(0);
    expect(rejectedV1Records).toBe(false);
    expect(validRecords).toHaveLength(1);

    const recovered = validRecords[0]!;
    expect(recovered.recordType).toBe("EPOCH_COMMIT");
    expect(recovered.payload).toEqual(commitPayload);
    validateFhvExecutionWalRecord(recovered, { expectedFencingGeneration: 1 });
  });

  it("rejects v1-looking WAL records on official recovery path", () => {
    runRoot = mkdtempSync(join(tmpdir(), "fhv-wal-v1-reject-"));
    const walPath = join(runRoot, "execution.wal.ndjson");
    const v1Record = {
      schemaVersion: "fhv-execution-wal-record/v1",
      walFormatVersion: "fhv-execution-wal/v1",
      runId: "legacy-run",
      epochId: 0,
      cycleIndex: 0,
      cycleCommitId: "legacy-run:0:0:commit",
      recordType: "EPOCH_COMMIT",
      payloadDigest: "0".repeat(64),
      previousRecordDigest: "0".repeat(64),
      length: 100,
      checksum: "f".repeat(64),
      executionPurpose: FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
      fencingGeneration: 1,
    };
    writeFileSync(walPath, `${JSON.stringify(v1Record)}\n`, "utf8");

    const tail = recoverFhvExecutionWalTail(walPath, { rejectV1: true });
    expect(tail.validRecords).toHaveLength(0);
    expect(tail.rejectedV1Records).toBe(true);

    expect(() =>
      FhvExecutionWalWriter.openExisting({
        runRoot,
        runId: "legacy-run",
        executionPurpose: FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
        fencingGeneration: 1,
      }),
    ).toThrow(FhvExecutionWalError);

    try {
      FhvExecutionWalWriter.openExisting({
        runRoot,
        runId: "legacy-run",
        executionPurpose: FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
        fencingGeneration: 1,
      });
      expect.unreachable("openExisting should reject v1 WAL");
    } catch (error) {
      expect(error).toBeInstanceOf(FhvExecutionWalError);
      expect((error as FhvExecutionWalError).code).toBe("WAL_SCHEMA_V1_UNSUPPORTED");
    }
  });
});
