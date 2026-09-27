import { closeSync, constants, fstatSync, openSync, readFileSync, readSync } from "node:fs";

/** A resource profile, never an authorization or a source-validation result. */
export const CONTROL_REPLAY_METADATA_PROFILE = "CONTROL_REPLAY_TRANSITION_V1" as const;
export const CONTROL_REPLAY_METADATA_MAX_BYTES = 1_048_576;
export type FhvMetadataReadOptions = Readonly<{
  metadataReadProfile?: typeof CONTROL_REPLAY_METADATA_PROFILE;
}>;

export class FhvMetadataReadError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvMetadataReadError";
  }
}

function enabled(options?: FhvMetadataReadOptions): boolean {
  if (options?.metadataReadProfile === undefined) return false;
  if (options.metadataReadProfile !== CONTROL_REPLAY_METADATA_PROFILE) {
    throw new FhvMetadataReadError(
      "CONTROL_REPLAY_METADATA_PROFILE_INVALID",
      "Unsupported metadata read profile.",
    );
  }
  return true;
}

export function assertMetadataBytesSupported(
  bytes: string | Buffer,
  options?: FhvMetadataReadOptions,
): void {
  if (enabled(options) && Buffer.byteLength(bytes) > CONTROL_REPLAY_METADATA_MAX_BYTES) {
    throw new FhvMetadataReadError(
      "CONTROL_REPLAY_METADATA_TOO_LARGE",
      "Control Replay metadata exceeds 1 MiB.",
    );
  }
}

/** Open once and bound allocation before materializing selected metadata. POSIX only. */
export function readMetadataBytesSync(path: string, options?: FhvMetadataReadOptions): Buffer {
  if (!enabled(options)) return readFileSync(path);
  // Opening a FIFO without O_NONBLOCK would hang before its type could be checked.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile()) {
      throw new FhvMetadataReadError(
        "CONTROL_REPLAY_METADATA_NOT_REGULAR",
        "Control Replay metadata must be a regular file.",
      );
    }
    if (before.size > CONTROL_REPLAY_METADATA_MAX_BYTES) {
      throw new FhvMetadataReadError(
        "CONTROL_REPLAY_METADATA_TOO_LARGE",
        "Control Replay metadata exceeds 1 MiB.",
      );
    }
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count <= 0) {
        throw new FhvMetadataReadError(
          "CONTROL_REPLAY_METADATA_READ_CHANGED",
          "Metadata shortened while reading.",
        );
      }
      offset += count;
    }
    const overflow = readSync(fd, Buffer.alloc(1), 0, 1, offset);
    const after = fstatSync(fd);
    if (
      after.size > CONTROL_REPLAY_METADATA_MAX_BYTES ||
      (offset === CONTROL_REPLAY_METADATA_MAX_BYTES && overflow > 0)
    ) {
      throw new FhvMetadataReadError(
        "CONTROL_REPLAY_METADATA_TOO_LARGE",
        "Control Replay metadata exceeds 1 MiB.",
      );
    }
    if (
      overflow !== 0 ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw new FhvMetadataReadError(
        "CONTROL_REPLAY_METADATA_READ_CHANGED",
        "Metadata changed while reading.",
      );
    }
    return bytes;
  } finally {
    closeSync(fd);
  }
}

export function readMetadataTextSync(path: string, options?: FhvMetadataReadOptions): string {
  return readMetadataBytesSync(path, options).toString("utf8");
}
