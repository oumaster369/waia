import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

const READ_CHUNK_BYTES = 64 * 1024;

export class BoundedJsonFileError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "BoundedJsonFileError";
  }
}

/**
 * Read one regular file through one descriptor. An explicit limit reads at most
 * maxBytes + 1 bytes, including if the file grows after it is opened. Omitting
 * the limit preserves the legacy receipt readers' unbounded size policy.
 */
export function readJsonFileBoundedSync(
  path: string,
  options: Readonly<{ maxBytes?: number }> = {},
): unknown {
  const maxBytes = options.maxBytes;
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1)) {
    throw new BoundedJsonFileError("JSON_FILE_BYTE_LIMIT_INVALID");
  }

  // O_NONBLOCK prevents a FIFO from hanging before fstat can reject it.
  // O_NOFOLLOW refuses a symlink rather than following it to another file.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile()) throw new BoundedJsonFileError("JSON_FILE_NOT_REGULAR");
    if (maxBytes !== undefined && before.size > maxBytes) {
      throw new BoundedJsonFileError("JSON_FILE_TOO_LARGE");
    }

    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const remaining = maxBytes === undefined ? READ_CHUNK_BYTES :
        Math.min(READ_CHUNK_BYTES, maxBytes - total + 1);
      const chunk = Buffer.allocUnsafe(remaining);
      const bytesRead = readSync(fd, chunk, 0, remaining, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (maxBytes !== undefined && total > maxBytes) {
        throw new BoundedJsonFileError("JSON_FILE_TOO_LARGE");
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }

    const after = fstatSync(fd);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs || total !== after.size) {
      throw new BoundedJsonFileError("JSON_FILE_CHANGED_DURING_READ");
    }
    return JSON.parse(Buffer.concat(chunks, total).toString("utf8")) as unknown;
  } finally {
    closeSync(fd);
  }
}
