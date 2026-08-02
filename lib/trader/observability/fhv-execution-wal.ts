import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type { FhvExecutionPurpose } from "@/lib/trader/observability/fhv-execution-purpose";

export const FHV_EXECUTION_WAL_FORMAT_VERSION = "fhv-execution-wal/v1" as const;
export const FHV_EXECUTION_WAL_RECORD_SCHEMA_VERSION = "fhv-execution-wal-record/v1" as const;

export const FHV_DEFAULT_CHECKPOINT_EVERY_CYCLES = 10_000;
export const FHV_DEFAULT_MAX_CHECKPOINT_WAL_BYTES = 67_108_864;

export type FhvExecutionWalRecordType =
  | "EPOCH_BEGIN"
  | "DECISION"
  | "ORDER"
  | "FILL"
  | "EXCHANGE_STATE"
  | "ACCOUNTING"
  | "RISK"
  | "INTELLIGENCE"
  | "EVIDENCE"
  | "EXECUTION_CHECKPOINT"
  | "EPOCH_COMMIT";

export type FhvExecutionWalRecord = Readonly<{
  schemaVersion: typeof FHV_EXECUTION_WAL_RECORD_SCHEMA_VERSION;
  walFormatVersion: typeof FHV_EXECUTION_WAL_FORMAT_VERSION;
  runId: string;
  epochId: number;
  cycleIndex: number;
  cycleCommitId: string;
  recordType: FhvExecutionWalRecordType;
  payloadDigest: string;
  previousRecordDigest: string;
  length: number;
  checksum: string;
  executionPurpose: FhvExecutionPurpose;
  fencingGeneration: number;
}>;

export type FhvEpochCommitRecord = Readonly<{
  firstCycle: number;
  lastCycle: number;
  walStartOffset: number;
  walEndOffset: number;
  recordCount: number;
  sourceCursorDigest: string;
  executionCheckpointDigest: string;
  evidenceFrontier: string;
  orderFillFrontier: string;
  authorizationClaimDigest: string;
  previousCommittedEpochDigest: string;
  epochCommitDigest: string;
}>;

export class FhvExecutionWalWriter {
  private readonly walPath: string;
  private previousRecordDigest = "0".repeat(64);
  private recordCount = 0;
  private bytesWritten = 0;
  private readonly fencingGeneration: number;

  constructor(
    private readonly runRoot: string,
    private readonly runId: string,
    private readonly executionPurpose: FhvExecutionPurpose,
    fencingGeneration: number,
  ) {
    mkdirSync(runRoot, { recursive: true });
    this.walPath = join(runRoot, "execution.wal.ndjson");
    this.fencingGeneration = fencingGeneration;
    if (!existsSync(this.walPath)) {
      writeFileSync(this.walPath, "", "utf8");
    }
  }

  static openExisting(input: {
    runRoot: string;
    runId: string;
    executionPurpose: FhvExecutionPurpose;
    fencingGeneration: number;
  }): FhvExecutionWalWriter {
    const writer = new FhvExecutionWalWriter(
      input.runRoot,
      input.runId,
      input.executionPurpose,
      input.fencingGeneration,
    );
    const { validRecords, truncatedTailBytes } = recoverFhvExecutionWalTail(writer.walPath);
    if (truncatedTailBytes > 0) {
      const validContent = validRecords.map((record) => `${JSON.stringify(record)}\n`).join("");
      writeFileSync(writer.walPath, validContent, "utf8");
    }
    if (validRecords.length > 0) {
      const last = validRecords.at(-1)!;
      writer.previousRecordDigest = last.checksum;
      writer.recordCount = validRecords.length;
      writer.bytesWritten = Buffer.byteLength(
        validRecords.map((record) => `${JSON.stringify(record)}\n`).join(""),
        "utf8",
      );
    }
    return writer;
  }

  getWalPath(): string {
    return this.walPath;
  }

  appendRecord(input: {
    epochId: number;
    cycleIndex: number;
    cycleCommitId: string;
    recordType: FhvExecutionWalRecordType;
    payload: unknown;
  }): FhvExecutionWalRecord {
    const payloadDigest = computeStableJsonDigest(input.payload);
    const body = {
      schemaVersion: FHV_EXECUTION_WAL_RECORD_SCHEMA_VERSION,
      walFormatVersion: FHV_EXECUTION_WAL_FORMAT_VERSION,
      runId: this.runId,
      epochId: input.epochId,
      cycleIndex: input.cycleIndex,
      cycleCommitId: input.cycleCommitId,
      recordType: input.recordType,
      payloadDigest,
      previousRecordDigest: this.previousRecordDigest,
      length: 0,
      checksum: "",
      executionPurpose: this.executionPurpose,
      fencingGeneration: this.fencingGeneration,
    };
    const line = JSON.stringify(body);
    const checksum = createHash("sha256").update(line, "utf8").digest("hex");
    const record: FhvExecutionWalRecord = { ...body, length: line.length, checksum };
    const serialized = `${JSON.stringify(record)}\n`;
    appendFileSync(this.walPath, serialized, "utf8");
    this.previousRecordDigest = checksum;
    this.recordCount += 1;
    this.bytesWritten += Buffer.byteLength(serialized, "utf8");
    return record;
  }

  get walBytesWritten(): number {
    return this.bytesWritten;
  }

  get totalRecords(): number {
    return this.recordCount;
  }
}

export function computeEpochCommitDigest(
  commit: Omit<FhvEpochCommitRecord, "epochCommitDigest">,
): string {
  return computeStableJsonDigest(commit);
}

export function recoverFhvExecutionWalTail(walPath: string): {
  validRecords: FhvExecutionWalRecord[];
  truncatedTailBytes: number;
} {
  if (!existsSync(walPath)) {
    return { validRecords: [], truncatedTailBytes: 0 };
  }
  const content = readFileSync(walPath, "utf8");
  const lines = content.split("\n").filter((line) => line.length > 0);
  const validRecords: FhvExecutionWalRecord[] = [];
  let previousDigest = "0".repeat(64);
  for (const line of lines) {
    try {
      const record = JSON.parse(line) as FhvExecutionWalRecord;
      if (record.previousRecordDigest !== previousDigest) {
        break;
      }
      const serialized = JSON.stringify({
        schemaVersion: record.schemaVersion,
        walFormatVersion: record.walFormatVersion,
        runId: record.runId,
        epochId: record.epochId,
        cycleIndex: record.cycleIndex,
        cycleCommitId: record.cycleCommitId,
        recordType: record.recordType,
        payloadDigest: record.payloadDigest,
        previousRecordDigest: record.previousRecordDigest,
        length: 0,
        checksum: "",
        executionPurpose: record.executionPurpose,
        fencingGeneration: record.fencingGeneration,
      });
      const expected = createHash("sha256").update(serialized, "utf8").digest("hex");
      if (expected !== record.checksum) {
        break;
      }
      validRecords.push(record);
      previousDigest = record.checksum;
    } catch {
      break;
    }
  }
  const validContent = validRecords.map((record) => `${JSON.stringify(record)}\n`).join("");
  const truncatedTailBytes =
    Buffer.byteLength(content, "utf8") - Buffer.byteLength(validContent, "utf8");
  return { validRecords, truncatedTailBytes };
}
