/**
 * DEE-436 — remote vs workstation path classification (fail-closed).
 */

import type { FhvT4aOperatorBindings } from "@/scripts/ops/fhv-t4a-operator";

export type FhvT4aRemotePathContext = Readonly<{
  artifactRoot: string;
  checkoutParent: string;
  repoRoot: string;
  runDir: string;
  installedUnitsDir: string;
  localStateDir: string;
  localReleaseRoot: string;
  workstationTracePath: string;
}>;

export function buildFhvT4aRemotePathContext(
  bindings: FhvT4aOperatorBindings,
  repoRoot: string,
  runDir: string,
): FhvT4aRemotePathContext {
  return {
    artifactRoot: bindings.artifactRoot,
    checkoutParent: bindings.checkoutParent,
    repoRoot,
    runDir,
    installedUnitsDir: "/etc/systemd/system",
    localStateDir: bindings.localStateDir,
    localReleaseRoot: bindings.localReleaseRoot,
    workstationTracePath: bindings.workstationTracePath,
  };
}

export function isFhvT4aRemotePath(path: string, ctx: FhvT4aRemotePathContext): boolean {
  const normalized = path.trim();
  if (!normalized.startsWith("/")) {
    return false;
  }
  const workstationPrefixes = [
    ctx.localStateDir,
    ctx.localReleaseRoot,
    ctx.workstationTracePath,
  ].filter(Boolean);
  for (const prefix of workstationPrefixes) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return false;
    }
  }
  const remotePrefixes = [
    ctx.artifactRoot,
    ctx.checkoutParent,
    ctx.repoRoot,
    ctx.runDir,
    ctx.installedUnitsDir,
  ];
  for (const prefix of remotePrefixes) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  if (normalized.startsWith("/etc/systemd/system")) {
    return true;
  }
  return false;
}

export class FhvT4aRemotePathGuardError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4aRemotePathGuardError";
  }
}

export function assertWorkstationLocalPath(
  path: string,
  ctx: FhvT4aRemotePathContext,
  operation: string,
): void {
  if (isFhvT4aRemotePath(path, ctx)) {
    throw new FhvT4aRemotePathGuardError(
      "REMOTE_PATH_ACCESSED_BY_LOCAL_FS",
      `${operation} forbids workstation filesystem access to remote path: ${path}`,
    );
  }
}
