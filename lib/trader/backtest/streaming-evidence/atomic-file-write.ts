import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { StreamingEvidenceError } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence.types";

let tempCounter = 0;

export class AtomicFileWriteError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AtomicFileWriteError";
  }
}

function writeFully(fd: number, payload: Buffer): void {
  let offset = 0;
  while (offset < payload.length) {
    const written = writeSync(fd, payload, offset, payload.length - offset);
    if (!Number.isInteger(written) || written <= 0) {
      throw new AtomicFileWriteError(
        "STREAMING_EVIDENCE_ATOMIC_EXCLUSIVE_WRITE_INCOMPLETE",
        `writeSync returned invalid byte count: ${String(written)}`,
      );
    }
    offset += written;
  }
}

function fsyncDirectoryStrict(directory: string): void {
  if (process.platform === "linux") {
    const dirFd = openSync(directory, "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
    return;
  }
  try {
    const dirFd = openSync(directory, "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch {
    // Non-Linux dev platforms may lack directory-fsync support.
  }
}

function createExclusiveTempPath(finalPath: string): string {
  const directory = dirname(finalPath);
  tempCounter += 1;
  return join(
    directory,
    `.${basename(finalPath)}.tmp-${process.pid}-${process.hrtime.bigint()}-${tempCounter}`,
  );
}

/** Acquire an exclusive O_EXCL lock file; returns fd for release. */
export function claimFileExclusiveLock(lockPath: string): number {
  const directory = dirname(lockPath);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }
  try {
    return openSync(lockPath, "wx");
  } catch (error) {
    throw new AtomicFileWriteError(
      "EXCLUSIVE_LOCK_HELD",
      `Exclusive lock already held: ${lockPath}: ${String(error)}`,
    );
  }
}

/** Release an exclusive lock acquired via claimFileExclusiveLock. */
export function releaseFileExclusiveLock(lockPath: string, fd: number): void {
  try {
    closeSync(fd);
  } finally {
    try {
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
    } catch {
      // best-effort lock cleanup
    }
  }
}

export function prepareAtomicExclusiveTemp(finalPath: string, bytes: Buffer | string): string {
  const payload = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
  const directory = dirname(finalPath);
  if (!existsSync(directory)) {
    throw new AtomicFileWriteError(
      "STREAMING_EVIDENCE_ATOMIC_EXCLUSIVE_DIRECTORY_MISSING",
      `destination directory missing: ${directory}`,
    );
  }
  const tempPath = createExclusiveTempPath(finalPath);
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx");
    writeFully(fd, payload);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    return tempPath;
  } catch (error) {
    if (fd !== null) {
      closeSync(fd);
    }
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
      // best-effort cleanup of writer-owned temp only
    }
    throw new AtomicFileWriteError(
      "STREAMING_EVIDENCE_ATOMIC_EXCLUSIVE_PREPARE_FAILED",
      `exclusive temp prepare failed for ${finalPath}: ${String(error)}`,
    );
  }
}

/** Publish a prepared temp exclusively via hard link (no-replace). */
export function publishAtomicExclusiveTemp(tempPath: string, finalPath: string): void {
  const directory = dirname(finalPath);
  try {
    linkSync(tempPath, finalPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EEXIST") {
      throw new AtomicFileWriteError(
        "PHASE_RECEIPT_OVERWRITE_ALLOWED",
        `Refusing to overwrite existing file: ${finalPath}`,
      );
    }
    throw new AtomicFileWriteError(
      "STREAMING_EVIDENCE_ATOMIC_EXCLUSIVE_PUBLISH_FAILED",
      `exclusive publish failed for ${finalPath}: ${String(error)}`,
    );
  }
  try {
    unlinkSync(tempPath);
  } catch {
    // temp hard-link removed; final path retains inode
  }
  fsyncDirectoryStrict(directory);
}

/** Create finalPath exclusively; fail closed if the target already exists. */
export function writeFileAtomicExclusive(finalPath: string, bytes: Buffer | string): void {
  if (existsSync(finalPath)) {
    throw new AtomicFileWriteError(
      "PHASE_RECEIPT_OVERWRITE_ALLOWED",
      `Refusing to overwrite existing file: ${finalPath}`,
    );
  }
  const tempPath = prepareAtomicExclusiveTemp(finalPath, bytes);
  try {
    publishAtomicExclusiveTemp(tempPath, finalPath);
  } catch (error) {
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
      // best-effort cleanup of writer-owned temp only
    }
    throw error;
  }
}

/**
 * Atomically replace an existing file only when its current bytes match `expectedContent`.
 * Uses temp write + fsync + rename (compare-and-replace / TOCTOU guard).
 */
export function writeFileAtomicCompareAndReplace(input: {
  finalPath: string;
  expectedContent: string;
  nextContent: string;
}): void {
  if (!existsSync(input.finalPath)) {
    throw new AtomicFileWriteError(
      "COMPARE_AND_REPLACE_TARGET_MISSING",
      `Compare-and-replace target missing: ${input.finalPath}`,
    );
  }
  const current = readFileSync(input.finalPath, "utf8");
  if (current !== input.expectedContent) {
    throw new AtomicFileWriteError(
      "COMPARE_AND_REPLACE_CONTENT_MISMATCH",
      `Compare-and-replace content mismatch for ${input.finalPath}`,
    );
  }
  const directory = dirname(input.finalPath);
  const tempPath = createExclusiveTempPath(input.finalPath);
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx");
    writeFully(fd, Buffer.from(input.nextContent, "utf8"));
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tempPath, input.finalPath);
    fsyncDirectoryStrict(directory);
  } catch (error) {
    if (fd !== null) {
      closeSync(fd);
    }
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
      // best-effort cleanup
    }
    throw new AtomicFileWriteError(
      "COMPARE_AND_REPLACE_WRITE_FAILED",
      `Compare-and-replace failed for ${input.finalPath}: ${String(error)}`,
    );
  }
}

export function writeFileAtomic(finalPath: string, bytes: Buffer | string): void {
  // Prefer writing the string/Buffer directly — avoid an extra Buffer.from copy on every
  // GS-10 evidence chunk flush (every MAX_BATCH_CYCLES=32 cycles).
  tempCounter += 1;
  const tempPath = `${finalPath}.tmp-${process.pid}-${process.hrtime.bigint()}-${tempCounter}`;

  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "w");
    if (typeof bytes === "string") {
      writeSync(fd, bytes, null, "utf8");
    } else {
      writeSync(fd, bytes);
    }
    // Evidence chunk writes: rename provides atomic visibility. Epoch seal / checkpoint
    // publish remains the durability boundary (IDHPS hot-path: skip per-chunk fsync).
    closeSync(fd);
    fd = null;
    renameSync(tempPath, finalPath);
  } catch (error) {
    if (fd !== null) {
      closeSync(fd);
    }
    try {
      writeFileSync(tempPath, bytes);
      renameSync(tempPath, finalPath);
    } catch {
      throw new StreamingEvidenceError(
        "STREAMING_EVIDENCE_ATOMIC_WRITE_FAILED",
        `[streaming-evidence] atomic write failed for ${finalPath}: ${String(error)}`,
      );
    }
  }
}
