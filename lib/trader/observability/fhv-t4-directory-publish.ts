/**
 * DEE-436 — directory-level atomic publish helper.
 */

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

export class FhvT4DirectoryPublishError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4DirectoryPublishError";
  }
}

export function publishDirectoryAtomic(stagingDir: string, finalDir: string): void {
  if (!existsSync(stagingDir)) {
    throw new FhvT4DirectoryPublishError(
      "FHV_T4_DIRECTORY_PUBLISH_STAGING_MISSING",
      `Staging directory missing: ${stagingDir}`,
    );
  }
  if (existsSync(finalDir)) {
    throw new FhvT4DirectoryPublishError(
      "FHV_T4_DIRECTORY_PUBLISH_FINAL_EXISTS",
      `Final directory already exists: ${finalDir}`,
    );
  }
  const parent = dirname(finalDir);
  mkdirSync(parent, { recursive: true });
  renameSync(stagingDir, finalDir);
  try {
    const dirFd = openSync(parent, "r");
    fsyncSync(dirFd);
    closeSync(dirFd);
  } catch {
    // best-effort directory fsync
  }
}

export function createUniqueStagingDirectory(parentDir: string, prefix: string): string {
  mkdirSync(parentDir, { recursive: true });
  const stagingDir = join(parentDir, `${prefix}.staging-${process.pid}-${Date.now()}`);
  mkdirSync(stagingDir, { recursive: true });
  return stagingDir;
}

export function cleanupStagingDirectory(stagingDir: string): void {
  if (existsSync(stagingDir)) {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}
