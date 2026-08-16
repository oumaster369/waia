import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readSync,
  statSync,
  truncateSync,
} from "node:fs";

import { assertPathDoesNotAccessBlindHoldoutPayload } from "@/lib/trader/market-data/fhv-blind-holdout-firewall";

const TAIL_WINDOW_BYTES = 65_536;

export class FhvNdjsonBoundedIoError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvNdjsonBoundedIoError";
  }
}

/** Last complete NDJSON record at a durable committed byte boundary. Never reads the whole file. */
export function readLastNdjsonRecordAtByteLength(
  filePath: string,
  committedByteLength: number,
): string | null {
  assertPathDoesNotAccessBlindHoldoutPayload(filePath);
  if (!existsSync(filePath) || committedByteLength <= 0) {
    return null;
  }
  const size = statSync(filePath).size;
  if (size < committedByteLength) {
    throw new FhvNdjsonBoundedIoError(
      "COMMITTED_BYTE_LENGTH_PAST_EOF",
      `file size ${size} < committedByteLength ${committedByteLength}`,
    );
  }
  const window = Math.min(TAIL_WINDOW_BYTES, committedByteLength);
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(window);
    const bytesRead = readSync(fd, buffer, 0, window, committedByteLength - window);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    const lines = text.split("\n").filter((line) => line.length > 0);
    return lines[lines.length - 1] ?? null;
  } finally {
    closeSync(fd);
  }
}

export function truncateFileToCommittedByteLength(
  filePath: string,
  committedByteLength: number,
): void {
  assertPathDoesNotAccessBlindHoldoutPayload(filePath);
  if (!existsSync(filePath)) {
    if (committedByteLength !== 0) {
      throw new FhvNdjsonBoundedIoError(
        "CURSOR_FILE_DIVERGENCE",
        "bars file missing while cursor committed bytes",
      );
    }
    return;
  }
  const size = statSync(filePath).size;
  if (size < committedByteLength) {
    throw new FhvNdjsonBoundedIoError(
      "CURSOR_FILE_DIVERGENCE",
      `bars file has ${size} bytes but cursor committed ${committedByteLength}`,
    );
  }
  if (size > committedByteLength) {
    truncateSync(filePath, committedByteLength);
    const fd = openSync(filePath, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
}

export function committedByteLengthOf(filePath: string): number {
  assertPathDoesNotAccessBlindHoldoutPayload(filePath);
  if (!existsSync(filePath)) {
    return 0;
  }
  return statSync(filePath).size;
}
