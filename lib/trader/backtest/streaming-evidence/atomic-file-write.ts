import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  openSync,
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

/** Prepare a writer-owned temp file with full payload written and fsynced. */
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

export function writeFileAtomic(finalPath: string, bytes: Buffer | string): void {
  const payload = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
  const directory = dirname(finalPath);
  tempCounter += 1;
  const tempPath = `${finalPath}.tmp-${process.pid}-${process.hrtime.bigint()}-${tempCounter}`;

  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "w");
    writeSync(fd, payload);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tempPath, finalPath);
    fsyncDirectoryStrict(directory);
  } catch (error) {
    if (fd !== null) {
      closeSync(fd);
    }
    try {
      writeFileSync(tempPath, payload);
      renameSync(tempPath, finalPath);
    } catch {
      throw new StreamingEvidenceError(
        "STREAMING_EVIDENCE_ATOMIC_WRITE_FAILED",
        `[streaming-evidence] atomic write failed for ${finalPath}: ${String(error)}`,
      );
    }
  }
}
