import { execSync } from "node:child_process";
import { join } from "node:path";

import {
  a3EvidenceDirectory,
  computeA3PackageSurfaceSemanticDigestHex,
  computeA3PhaseIdentityLayers,
  computeA3RelationInventoryDigestHex,
  type A3PhaseIdentityLayersV1,
} from "@/lib/trader/intelligence/forecast-v2/a3-storage-contract-v1";

export const A3_REPO_ROOT = join(__dirname, "../..");
export const A3_PHASE01_TIMEOUT_MS = 8 * 60 * 60 * 1000;
export const A3_PHASE_LOCK_PATH = join("/tmp", "dee518-a3-phase.lock");

export function loadDirtyTreeDigestHex(): string {
  return execSync("git status --porcelain | shasum | awk '{print $1}'", {
    cwd: A3_REPO_ROOT,
    encoding: "utf8",
  }).trim();
}

export function loadA3PhaseIdentityLayers(): A3PhaseIdentityLayersV1 {
  const localHeadCommit = execSync("git rev-parse HEAD", {
    cwd: A3_REPO_ROOT,
    encoding: "utf8",
  }).trim();
  return computeA3PhaseIdentityLayers({
    repoRoot: A3_REPO_ROOT,
    localHeadCommit,
    dirtyTreeDigestHex: loadDirtyTreeDigestHex(),
  });
}

/** @deprecated */
export function loadA3StorageContractIdentity(): A3PhaseIdentityLayersV1 {
  return loadA3PhaseIdentityLayers();
}

export function a3EvidenceDirForCurrentContract(): string {
  const identity = loadA3PhaseIdentityLayers();
  return a3EvidenceDirectory(identity.a3CanonicalContractDigest);
}

export function buildA3RunProvenance(input: {
  runId: string;
  logPath: string;
  startedAt: string;
  completedAt?: string;
}): {
  localHead: string;
  worktreeProvenanceDigest: string;
  runId: string;
  startedAt: string;
  completedAt: string;
  logPath: string;
  pid: number;
} {
  const identity = loadA3PhaseIdentityLayers();
  return {
    localHead: identity.localHeadCommit,
    worktreeProvenanceDigest: identity.worktreeProvenanceDigest,
    runId: input.runId,
    startedAt: input.startedAt,
    completedAt: input.completedAt ?? new Date().toISOString(),
    logPath: input.logPath,
    pid: process.pid,
  };
}

export { computeA3PackageSurfaceSemanticDigestHex, computeA3RelationInventoryDigestHex };
