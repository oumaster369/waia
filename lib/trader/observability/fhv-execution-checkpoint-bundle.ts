import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, join } from "node:path";

import { computeStableJsonDigest } from "@/lib/trader/research/digest";

export const FHV_EXECUTION_CHECKPOINT_MANIFEST_SCHEMA_VERSION =
  "fhv-execution-checkpoint-manifest/v1" as const;

export const FHV_CHECKPOINT_MANIFEST_FILENAME = "checkpoint-manifest.v1.json" as const;
export const FHV_CHECKPOINT_READY_MARKER = ".ready" as const;

export type FhvExecutionCheckpointManifestFileEntry = Readonly<{
  relativePath: string;
  byteCount: number;
  sha256: string;
}>;

export type FhvExecutionCheckpointManifestV1 = Readonly<{
  schemaVersion: typeof FHV_EXECUTION_CHECKPOINT_MANIFEST_SCHEMA_VERSION;
  runId: string;
  epochId: number;
  generation: number;
  firstCycle: number;
  lastCycle: number;
  files: readonly FhvExecutionCheckpointManifestFileEntry[];
  sourceCursorDigest: string;
  executionStateDigest: string;
  accountingFrontierDigest: string;
  identityFrontierDigest: string;
  evidenceFrontierDigest: string;
  sessionDatabaseDigest: string;
  checkpointContentDigest: string;
  syntheticScaleAuthorityDigest?: string;
  executionConfigurationDigest?: string;
}>;

export class FhvExecutionCheckpointBundleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvExecutionCheckpointBundleError";
  }
}

let tempNonce = 0;

function fsyncDirectoryStrict(directory: string): void {
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

function writeFileExclusiveFsync(filePath: string, payload: Buffer): void {
  if (existsSync(filePath)) {
    throw new FhvExecutionCheckpointBundleError(
      "CHECKPOINT_FILE_EXISTS",
      `Refusing to overwrite existing checkpoint file: ${filePath}`,
    );
  }
  let fd: number | null = null;
  try {
    fd = openSync(filePath, "wx");
    let offset = 0;
    while (offset < payload.length) {
      const written = writeSync(fd, payload, offset, payload.length - offset);
      if (!Number.isInteger(written) || written <= 0) {
        throw new FhvExecutionCheckpointBundleError(
          "CHECKPOINT_FILE_WRITE_INCOMPLETE",
          `writeSync returned invalid byte count for ${filePath}`,
        );
      }
      offset += written;
    }
    fsyncSync(fd);
  } finally {
    if (fd !== null) {
      closeSync(fd);
    }
  }
}

function sha256Buffer(payload: Buffer): string {
  return createHash("sha256").update(payload).digest("hex");
}

function formatEpochCheckpointDirName(epochId: number): string {
  return `epoch-${epochId}`;
}

export function resolveFhvEpochCheckpointDir(runDir: string, epochId: number): string {
  return join(runDir, "checkpoints", formatEpochCheckpointDirName(epochId));
}

export function resolveFhvEpochCheckpointRelativePath(epochId: number): string {
  return join("checkpoints", formatEpochCheckpointDirName(epochId));
}

function computeCheckpointContentDigest(
  body: Omit<FhvExecutionCheckpointManifestV1, "checkpointContentDigest">,
): string {
  return computeStableJsonDigest(body);
}

function buildManifest(input: {
  runId: string;
  epochId: number;
  generation: number;
  firstCycle: number;
  lastCycle: number;
  files: readonly FhvExecutionCheckpointManifestFileEntry[];
  sourceCursorDigest: string;
  executionStateDigest: string;
  accountingFrontierDigest: string;
  identityFrontierDigest: string;
  evidenceFrontierDigest: string;
  sessionDatabaseDigest: string;
  syntheticScaleAuthorityDigest?: string;
  executionConfigurationDigest?: string;
}): FhvExecutionCheckpointManifestV1 {
  const body: Omit<FhvExecutionCheckpointManifestV1, "checkpointContentDigest"> = {
    schemaVersion: FHV_EXECUTION_CHECKPOINT_MANIFEST_SCHEMA_VERSION,
    runId: input.runId,
    epochId: input.epochId,
    generation: input.generation,
    firstCycle: input.firstCycle,
    lastCycle: input.lastCycle,
    files: input.files,
    sourceCursorDigest: input.sourceCursorDigest,
    executionStateDigest: input.executionStateDigest,
    accountingFrontierDigest: input.accountingFrontierDigest,
    identityFrontierDigest: input.identityFrontierDigest,
    evidenceFrontierDigest: input.evidenceFrontierDigest,
    sessionDatabaseDigest: input.sessionDatabaseDigest,
    ...(input.syntheticScaleAuthorityDigest
      ? { syntheticScaleAuthorityDigest: input.syntheticScaleAuthorityDigest }
      : {}),
    ...(input.executionConfigurationDigest
      ? { executionConfigurationDigest: input.executionConfigurationDigest }
      : {}),
  };
  return {
    ...body,
    checkpointContentDigest: computeCheckpointContentDigest(body),
  };
}

export function publishFhvExecutionCheckpointBundle(input: {
  runDir: string;
  runId: string;
  epochId: number;
  generation: number;
  firstCycle: number;
  lastCycle: number;
  files: Readonly<Record<string, Buffer | string>>;
  sourceCursorDigest: string;
  executionStateDigest: string;
  accountingFrontierDigest: string;
  identityFrontierDigest: string;
  evidenceFrontierDigest: string;
  sessionDatabaseDigest: string;
  syntheticScaleAuthorityDigest?: string;
  executionConfigurationDigest?: string;
}): {
  checkpointDir: string;
  checkpointRelativePath: string;
  manifest: FhvExecutionCheckpointManifestV1;
} {
  const checkpointsParent = join(input.runDir, "checkpoints");
  const finalDir = resolveFhvEpochCheckpointDir(input.runDir, input.epochId);
  if (existsSync(finalDir)) {
    throw new FhvExecutionCheckpointBundleError(
      "CHECKPOINT_EPOCH_EXISTS",
      `Refusing to overwrite existing epoch checkpoint directory: ${finalDir}`,
    );
  }

  mkdirSync(checkpointsParent, { recursive: true });
  tempNonce += 1;
  const tempDir = join(
    checkpointsParent,
    `.epoch-${input.epochId}.tmp-${process.pid}-${tempNonce}`,
  );
  if (existsSync(tempDir)) {
    throw new FhvExecutionCheckpointBundleError(
      "CHECKPOINT_TEMP_EXISTS",
      `Exclusive temp checkpoint directory already exists: ${tempDir}`,
    );
  }
  mkdirSync(tempDir, { recursive: true });

  const fileEntries: FhvExecutionCheckpointManifestFileEntry[] = [];
  try {
    for (const [relativePath, content] of Object.entries(input.files)) {
      if (relativePath.includes("..") || relativePath.startsWith("/")) {
        throw new FhvExecutionCheckpointBundleError(
          "CHECKPOINT_FILE_PATH_INVALID",
          `Invalid checkpoint relative path: ${relativePath}`,
        );
      }
      const payload = typeof content === "string" ? Buffer.from(content, "utf8") : content;
      const destPath = join(tempDir, relativePath);
      mkdirSync(join(destPath, ".."), { recursive: true });
      writeFileExclusiveFsync(destPath, payload);
      fileEntries.push({
        relativePath,
        byteCount: payload.length,
        sha256: sha256Buffer(payload),
      });
    }

    fileEntries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    const manifest = buildManifest({
      runId: input.runId,
      epochId: input.epochId,
      generation: input.generation,
      firstCycle: input.firstCycle,
      lastCycle: input.lastCycle,
      files: fileEntries,
      sourceCursorDigest: input.sourceCursorDigest,
      executionStateDigest: input.executionStateDigest,
      accountingFrontierDigest: input.accountingFrontierDigest,
      identityFrontierDigest: input.identityFrontierDigest,
      evidenceFrontierDigest: input.evidenceFrontierDigest,
      sessionDatabaseDigest: input.sessionDatabaseDigest,
      ...(input.syntheticScaleAuthorityDigest
        ? { syntheticScaleAuthorityDigest: input.syntheticScaleAuthorityDigest }
        : {}),
      ...(input.executionConfigurationDigest
        ? { executionConfigurationDigest: input.executionConfigurationDigest }
        : {}),
    });

    const manifestPath = join(tempDir, FHV_CHECKPOINT_MANIFEST_FILENAME);
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    writeFileExclusiveFsync(manifestPath, manifestBytes);

    const readyPath = join(tempDir, FHV_CHECKPOINT_READY_MARKER);
    writeFileExclusiveFsync(readyPath, Buffer.from("", "utf8"));

    fsyncDirectoryStrict(tempDir);

    renameSync(tempDir, finalDir);
    fsyncDirectoryStrict(checkpointsParent);

    return {
      checkpointDir: finalDir,
      checkpointRelativePath: resolveFhvEpochCheckpointRelativePath(input.epochId),
      manifest,
    };
  } catch (error) {
    try {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // best-effort cleanup
    }
    throw error;
  }
}

function readManifestFromCheckpointDir(checkpointDir: string): FhvExecutionCheckpointManifestV1 {
  const manifestPath = join(checkpointDir, FHV_CHECKPOINT_MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) {
    throw new FhvExecutionCheckpointBundleError(
      "CHECKPOINT_MANIFEST_MISSING",
      `Checkpoint manifest missing: ${manifestPath}`,
    );
  }
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  ) as FhvExecutionCheckpointManifestV1;
  const { checkpointContentDigest, ...body } = manifest;
  if (computeCheckpointContentDigest(body) !== checkpointContentDigest) {
    throw new FhvExecutionCheckpointBundleError(
      "CHECKPOINT_CONTENT_DIGEST_MISMATCH",
      "checkpoint manifest content digest mismatch",
    );
  }
  return manifest;
}

export function readFhvExecutionCheckpointFile<T>(checkpointDir: string, relativePath: string): T {
  const filePath = join(checkpointDir, relativePath);
  if (!existsSync(filePath)) {
    throw new FhvExecutionCheckpointBundleError(
      "CHECKPOINT_FILE_MISSING",
      `Checkpoint file missing: ${relativePath}`,
    );
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

export function readFhvExecutionCheckpointBundle(checkpointDir: string): {
  manifest: FhvExecutionCheckpointManifestV1;
} {
  const readyPath = join(checkpointDir, FHV_CHECKPOINT_READY_MARKER);
  if (!existsSync(readyPath)) {
    throw new FhvExecutionCheckpointBundleError(
      "CHECKPOINT_NOT_READY",
      `Checkpoint directory missing .ready marker: ${checkpointDir}`,
    );
  }

  const manifest = readManifestFromCheckpointDir(checkpointDir);

  for (const entry of manifest.files) {
    const filePath = join(checkpointDir, entry.relativePath);
    if (!existsSync(filePath)) {
      throw new FhvExecutionCheckpointBundleError(
        "CHECKPOINT_FILE_MISSING",
        `Checkpoint file missing: ${entry.relativePath}`,
      );
    }
    const payload = readFileSync(filePath);
    if (payload.length !== entry.byteCount) {
      throw new FhvExecutionCheckpointBundleError(
        "CHECKPOINT_FILE_SIZE_MISMATCH",
        `Checkpoint file size mismatch for ${entry.relativePath}`,
      );
    }
    if (sha256Buffer(payload) !== entry.sha256) {
      throw new FhvExecutionCheckpointBundleError(
        "CHECKPOINT_FILE_DIGEST_MISMATCH",
        `Checkpoint file digest mismatch for ${entry.relativePath}`,
      );
    }
  }

  const sessionEntry = manifest.files.find(
    (entry) => basename(entry.relativePath) === "session.sqlite",
  );
  if (sessionEntry && sessionEntry.sha256 !== manifest.sessionDatabaseDigest) {
    throw new FhvExecutionCheckpointBundleError(
      "CHECKPOINT_SESSION_DIGEST_MISMATCH",
      "sessionDatabaseDigest does not match session.sqlite file digest",
    );
  }

  return { manifest };
}
