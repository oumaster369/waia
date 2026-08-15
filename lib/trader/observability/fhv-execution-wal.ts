import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type { FhvExecutionPurpose } from "@/lib/trader/observability/fhv-execution-purpose";

export const FHV_EXECUTION_WAL_FORMAT_VERSION = "fhv-execution-wal/v2" as const;
export const FHV_EXECUTION_WAL_RECORD_SCHEMA_VERSION = "fhv-execution-wal-record/v2" as const;

const FHV_EXECUTION_WAL_RECORD_SCHEMA_V1 = "fhv-execution-wal-record/v1" as const;

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
  payload: unknown;
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
  checkpointRelativePath?: string;
  sessionDatabaseDigest?: string;
}>;

export class FhvExecutionWalError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvExecutionWalError";
  }
}

type WalRecordChecksumBody = Omit<FhvExecutionWalRecord, "payload" | "length" | "checksum"> & {
  length: 0;
  checksum: "";
};

function buildWalRecordChecksumBody(
  record: Pick<
    FhvExecutionWalRecord,
    | "schemaVersion"
    | "walFormatVersion"
    | "runId"
    | "epochId"
    | "cycleIndex"
    | "cycleCommitId"
    | "recordType"
    | "payloadDigest"
    | "previousRecordDigest"
    | "executionPurpose"
    | "fencingGeneration"
  >,
): WalRecordChecksumBody {
  return {
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
  };
}

function computeWalRecordChecksum(
  record: Parameters<typeof buildWalRecordChecksumBody>[0],
): string {
  const body = buildWalRecordChecksumBody(record);
  return createHash("sha256").update(JSON.stringify(body), "utf8").digest("hex");
}

function isV1WalRecord(record: { schemaVersion?: string }): boolean {
  return record.schemaVersion === FHV_EXECUTION_WAL_RECORD_SCHEMA_V1;
}

function isRecognizedV2WalRecord(record: {
  schemaVersion?: string;
  payload?: unknown;
}): record is FhvExecutionWalRecord {
  return (
    record.schemaVersion === FHV_EXECUTION_WAL_RECORD_SCHEMA_VERSION &&
    "payload" in record &&
    record.payload !== undefined
  );
}

export function validateFhvExecutionWalRecord(
  record: FhvExecutionWalRecord,
  context?: Readonly<{
    expectedPreviousDigest?: string;
    expectedFencingGeneration?: number;
  }>,
): void {
  if (isV1WalRecord(record)) {
    throw new FhvExecutionWalError(
      "WAL_SCHEMA_V1_UNSUPPORTED",
      "FHV execution WAL v1 records are unsupported on the official recovery path",
    );
  }
  if (record.walFormatVersion !== FHV_EXECUTION_WAL_FORMAT_VERSION) {
    throw new FhvExecutionWalError(
      "WAL_FORMAT_VERSION_MISMATCH",
      `expected walFormatVersion ${FHV_EXECUTION_WAL_FORMAT_VERSION}, got ${String(record.walFormatVersion)}`,
    );
  }
  const expectedPayloadDigest = computeStableJsonDigest(record.payload);
  if (record.payloadDigest !== expectedPayloadDigest) {
    throw new FhvExecutionWalError(
      "WAL_PAYLOAD_DIGEST_MISMATCH",
      "payloadDigest does not match computeStableJsonDigest(payload)",
    );
  }
  if (
    context?.expectedPreviousDigest !== undefined &&
    record.previousRecordDigest !== context.expectedPreviousDigest
  ) {
    throw new FhvExecutionWalError(
      "WAL_PREVIOUS_DIGEST_MISMATCH",
      "previousRecordDigest chain is broken",
    );
  }
  if (
    context?.expectedFencingGeneration !== undefined &&
    record.fencingGeneration !== context.expectedFencingGeneration
  ) {
    throw new FhvExecutionWalError(
      "WAL_FENCING_GENERATION_MISMATCH",
      "fencingGeneration does not match expected writer generation",
    );
  }
  const checksumBody = buildWalRecordChecksumBody(record);
  const expectedChecksum = computeWalRecordChecksum(record);
  if (record.checksum !== expectedChecksum) {
    throw new FhvExecutionWalError("WAL_CHECKSUM_MISMATCH", "record checksum mismatch");
  }
  const expectedLength = JSON.stringify(checksumBody).length;
  if (record.length !== expectedLength) {
    throw new FhvExecutionWalError("WAL_LENGTH_MISMATCH", "record length mismatch");
  }
}

/** fsync the WAL file after append — exported for durability tests. */
export function fsyncFhvExecutionWalFile(walPath: string): void {
  const fd = openSync(walPath, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Indirection so append + tests can observe fsync without mocking node:fs. */
export const fhvExecutionWalDurability = {
  fsyncAfterAppend(walPath: string): void {
    fsyncFhvExecutionWalFile(walPath);
  },
};

export class FhvExecutionWalWriter {
  private readonly walPath: string;
  private previousRecordDigest = "0".repeat(64);
  private recordCount = 0;
  private bytesWritten = 0;
  private readonly fencingGeneration: number;
  /** When set, only EXECUTION_CHECKPOINT / EPOCH_COMMIT for this epoch may append. */
  private frozenUntilEpochCommit: number | null = null;

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
    const { validRecords, truncatedTailBytes, rejectedV1Records } = recoverFhvExecutionWalTail(
      writer.walPath,
      { rejectV1: true },
    );
    if (rejectedV1Records) {
      throw new FhvExecutionWalError(
        "WAL_SCHEMA_V1_UNSUPPORTED",
        "FHV execution WAL v1 records are unsupported on the official recovery path",
      );
    }
    if (truncatedTailBytes > 0) {
      const validContent = validRecords.map((record) => `${JSON.stringify(record)}\n`).join("");
      writeFileSync(writer.walPath, validContent, "utf8");
      fsyncFhvExecutionWalFile(writer.walPath);
    }
    if (validRecords.length > 0) {
      for (const record of validRecords) {
        validateFhvExecutionWalRecord(record, {
          expectedFencingGeneration:
            record.fencingGeneration === input.fencingGeneration
              ? input.fencingGeneration
              : undefined,
        });
      }
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
    if (this.frozenUntilEpochCommit !== null) {
      const allowed =
        input.epochId === this.frozenUntilEpochCommit &&
        (input.recordType === "EXECUTION_CHECKPOINT" || input.recordType === "EPOCH_COMMIT");
      if (!allowed) {
        throw new FhvExecutionWalError(
          "FHV_CANONICAL_WAL_APPEND_WHILE_FROZEN",
          `canonical WAL frozen through EPOCH_COMMIT ${this.frozenUntilEpochCommit}; refused ${input.recordType} epoch=${input.epochId}`,
        );
      }
    }
    const payloadDigest = computeStableJsonDigest(input.payload);
    const body = buildWalRecordChecksumBody({
      schemaVersion: FHV_EXECUTION_WAL_RECORD_SCHEMA_VERSION,
      walFormatVersion: FHV_EXECUTION_WAL_FORMAT_VERSION,
      runId: this.runId,
      epochId: input.epochId,
      cycleIndex: input.cycleIndex,
      cycleCommitId: input.cycleCommitId,
      recordType: input.recordType,
      payloadDigest,
      previousRecordDigest: this.previousRecordDigest,
      executionPurpose: this.executionPurpose,
      fencingGeneration: this.fencingGeneration,
    });
    const line = JSON.stringify(body);
    const checksum = computeWalRecordChecksum(body);
    const record: FhvExecutionWalRecord = {
      ...body,
      payload: input.payload,
      length: line.length,
      checksum,
    };
    validateFhvExecutionWalRecord(record, {
      expectedPreviousDigest: this.previousRecordDigest,
      expectedFencingGeneration: this.fencingGeneration,
    });
    const serialized = `${JSON.stringify(record)}\n`;
    appendFileSync(this.walPath, serialized, "utf8");
    fhvExecutionWalDurability.fsyncAfterAppend(this.walPath);
    this.previousRecordDigest = checksum;
    this.recordCount += 1;
    this.bytesWritten += Buffer.byteLength(serialized, "utf8");
    if (input.recordType === "EPOCH_COMMIT" && input.epochId === this.frozenUntilEpochCommit) {
      this.frozenUntilEpochCommit = null;
    }
    return record;
  }

  get walBytesWritten(): number {
    return this.bytesWritten;
  }

  get totalRecords(): number {
    return this.recordCount;
  }

  freezeUntilEpochCommit(epochId: number): void {
    this.frozenUntilEpochCommit = epochId;
  }

  isFrozen(): boolean {
    return this.frozenUntilEpochCommit !== null;
  }
}

export function computeEpochCommitDigest(
  commit: Omit<FhvEpochCommitRecord, "epochCommitDigest">,
): string {
  return computeStableJsonDigest(commit);
}

export function recoverFhvExecutionWalTail(
  walPath: string,
  options?: Readonly<{ rejectV1?: boolean }>,
): {
  validRecords: FhvExecutionWalRecord[];
  truncatedTailBytes: number;
  rejectedV1Records: boolean;
} {
  if (!existsSync(walPath)) {
    return { validRecords: [], truncatedTailBytes: 0, rejectedV1Records: false };
  }
  const content = readFileSync(walPath, "utf8");
  const lines = content.split("\n").filter((line) => line.length > 0);
  const validRecords: FhvExecutionWalRecord[] = [];
  let previousDigest = "0".repeat(64);
  let rejectedV1Records = false;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as FhvExecutionWalRecord;
      if (isV1WalRecord(parsed)) {
        rejectedV1Records = true;
        if (options?.rejectV1) {
          break;
        }
        break;
      }
      if (!isRecognizedV2WalRecord(parsed)) {
        break;
      }
      if (parsed.previousRecordDigest !== previousDigest) {
        break;
      }
      validateFhvExecutionWalRecord(parsed);
      validRecords.push(parsed);
      previousDigest = parsed.checksum;
    } catch {
      break;
    }
  }
  const validContent = validRecords.map((record) => `${JSON.stringify(record)}\n`).join("");
  const truncatedTailBytes =
    Buffer.byteLength(content, "utf8") - Buffer.byteLength(validContent, "utf8");
  return { validRecords, truncatedTailBytes, rejectedV1Records };
}

export type FhvJournalAuthoritativeWalPrefix = Readonly<{
  records: FhvExecutionWalRecord[];
  truncatedToBytes: number;
  previousRecordDigest: string;
}>;

/**
 * Truncate canonical WAL to the physical end of the unique journal-authoritative EPOCH_COMMIT.
 * Do not use FhvEpochCommitRecord.walEndOffset — that offset excludes the EPOCH_COMMIT line.
 */
export function truncateFhvExecutionWalToJournalAuthoritativeCommit(input: {
  walPath: string;
  lastCommittedEpoch: number;
  lastCommittedCycle: number;
  lastEpochCommitDigest: string;
}): FhvJournalAuthoritativeWalPrefix {
  const recovery = recoverFhvExecutionWalTail(input.walPath, { rejectV1: true });
  if (recovery.rejectedV1Records) {
    throw new FhvExecutionWalError(
      "WAL_SCHEMA_V1_UNSUPPORTED",
      "FHV execution WAL v1 records are unsupported on the official recovery path",
    );
  }
  if (input.lastCommittedEpoch < 0) {
    writeFileSync(input.walPath, "", "utf8");
    fsyncFhvExecutionWalFile(input.walPath);
    return {
      records: [],
      truncatedToBytes: 0,
      previousRecordDigest: "0".repeat(64),
    };
  }
  const matches = recovery.validRecords
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => {
      if (record.recordType !== "EPOCH_COMMIT") return false;
      if (record.epochId !== input.lastCommittedEpoch) return false;
      if (record.cycleIndex !== input.lastCommittedCycle) return false;
      const payload = record.payload as { epochCommitDigest?: string };
      return payload.epochCommitDigest === input.lastEpochCommitDigest;
    });
  if (matches.length !== 1) {
    throw new FhvExecutionWalError(
      "FHV_WAL_JOURNAL_COMMIT_NOT_UNIQUE",
      `journal-authoritative EPOCH_COMMIT not uniquely found (matches=${matches.length}) epoch=${input.lastCommittedEpoch}`,
    );
  }
  const prefix = recovery.validRecords.slice(0, matches[0]!.index + 1);
  const validContent = prefix.map((record) => `${JSON.stringify(record)}\n`).join("");
  writeFileSync(input.walPath, validContent, "utf8");
  fsyncFhvExecutionWalFile(input.walPath);
  const last = prefix.at(-1)!;
  return {
    records: prefix,
    truncatedToBytes: Buffer.byteLength(validContent, "utf8"),
    previousRecordDigest: last.checksum,
  };
}
