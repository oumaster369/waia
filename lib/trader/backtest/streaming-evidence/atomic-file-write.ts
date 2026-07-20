import { closeSync, fsyncSync, openSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";

import { StreamingEvidenceError } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence.types";

let tempCounter = 0;

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
    try {
      const dirFd = openSync(directory, "r");
      fsyncSync(dirFd);
      closeSync(dirFd);
    } catch {
      // Directory fsync is best-effort on platforms without directory fd support.
    }
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
