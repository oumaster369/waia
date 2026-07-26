/**
 * DEE-436 — read-only Git checkout / release-tag identity verifier.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";

export const FHV_T4_CHECKOUT_IDENTITY_SCHEMA_VERSION = "fhv-t4-checkout-identity/v1" as const;
export const FHV_T4_CHECKOUT_IDENTITY_FILENAME = "fhv-t4-checkout-identity.v1.json" as const;

export type FhvT4CheckoutIdentityProofV1 = Readonly<{
  schemaVersion: typeof FHV_T4_CHECKOUT_IDENTITY_SCHEMA_VERSION;
  repoPath: string;
  releaseSha: string;
  releaseTag: string;
  headSha: string;
  tagPeelSha: string;
  trackedTreeClean: true;
  stagedChanges: false;
  mergeInProgress: false;
  runId: string;
  organizationId: string;
  capturedAtUtc: string;
  contentDigest: string;
}>;

export class FhvT4CheckoutIdentityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4CheckoutIdentityError";
  }
}

const FULL_SHA = /^[0-9a-f]{40}$/;

function git(repoPath: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitOk(repoPath: string, args: readonly string[]): boolean {
  try {
    execFileSync("git", ["-C", repoPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

export function resolveFhvT4CheckoutIdentityPath(runRoot: string): string {
  return join(runRoot, "control", FHV_T4_CHECKOUT_IDENTITY_FILENAME);
}

export function verifyFhvReleaseCheckoutIdentity(input: {
  repoPath: string;
  targetSha: string;
  releaseTag: string;
}): {
  headSha: string;
  tagPeelSha: string;
  trackedTreeClean: true;
  stagedChanges: false;
  mergeInProgress: false;
} {
  const repoPath = input.repoPath.trim();
  const targetSha = input.targetSha.trim().toLowerCase();
  const releaseTag = input.releaseTag.trim();
  if (!repoPath) {
    throw new FhvT4CheckoutIdentityError("FHV_T4_CHECKOUT_REPO_REQUIRED", "repo-path required.");
  }
  if (!FULL_SHA.test(targetSha)) {
    throw new FhvT4CheckoutIdentityError(
      "FHV_T4_CHECKOUT_TARGET_SHA_INVALID",
      "target-sha must be a 40-char lowercase hex SHA.",
    );
  }
  if (!releaseTag) {
    throw new FhvT4CheckoutIdentityError(
      "FHV_T4_CHECKOUT_RELEASE_TAG_REQUIRED",
      "release-tag required.",
    );
  }
  if (!gitOk(repoPath, ["rev-parse", "--is-inside-work-tree"])) {
    throw new FhvT4CheckoutIdentityError(
      "FHV_T4_CHECKOUT_NOT_GIT_WORKTREE",
      `Not a git worktree: ${repoPath}`,
    );
  }
  if (!gitOk(repoPath, ["cat-file", "-e", `${targetSha}^{commit}`])) {
    throw new FhvT4CheckoutIdentityError(
      "FHV_T4_CHECKOUT_TARGET_SHA_UNRESOLVED",
      "target-sha does not resolve to a local commit.",
    );
  }
  const headSha = git(repoPath, ["rev-parse", "HEAD"]).toLowerCase();
  if (headSha !== targetSha) {
    throw new FhvT4CheckoutIdentityError(
      "FHV_T4_CHECKOUT_HEAD_MISMATCH",
      `HEAD ${headSha} != target ${targetSha}`,
    );
  }
  if (!gitOk(repoPath, ["rev-parse", "--verify", `refs/tags/${releaseTag}`])) {
    throw new FhvT4CheckoutIdentityError(
      "FHV_T4_CHECKOUT_TAG_MISSING",
      `Release tag not found locally: ${releaseTag}`,
    );
  }
  const tagPeelSha = git(repoPath, ["rev-parse", `${releaseTag}^{}`]).toLowerCase();
  if (tagPeelSha !== targetSha) {
    throw new FhvT4CheckoutIdentityError(
      "FHV_T4_CHECKOUT_TAG_PEEL_MISMATCH",
      `Tag ${releaseTag} peels to ${tagPeelSha}, not ${targetSha}`,
    );
  }
  // Tracked tree only (-uno ignores untracked); staged changes checked separately.
  const porcelain = git(repoPath, ["status", "--porcelain=v1", "-uno"]);
  if (porcelain.length > 0) {
    throw new FhvT4CheckoutIdentityError(
      "FHV_T4_CHECKOUT_TREE_DIRTY",
      "Tracked tree must be clean (no modified/deleted tracked files).",
    );
  }
  const staged = git(repoPath, ["diff", "--cached", "--name-only"]);
  if (staged.length > 0) {
    throw new FhvT4CheckoutIdentityError(
      "FHV_T4_CHECKOUT_STAGED_CHANGES",
      "Staged changes are forbidden.",
    );
  }
  if (
    existsSync(join(repoPath, ".git", "MERGE_HEAD")) ||
    existsSync(join(repoPath, ".git", "rebase-merge")) ||
    existsSync(join(repoPath, ".git", "rebase-apply"))
  ) {
    throw new FhvT4CheckoutIdentityError(
      "FHV_T4_CHECKOUT_MERGE_IN_PROGRESS",
      "Unresolved merge/rebase state is forbidden.",
    );
  }
  return {
    headSha,
    tagPeelSha,
    trackedTreeClean: true,
    stagedChanges: false,
    mergeInProgress: false,
  };
}

export function writeFhvT4CheckoutIdentityProofAtomic(input: {
  runRoot: string;
  repoPath: string;
  targetSha: string;
  releaseTag: string;
  runId: string;
  organizationId: string;
  capturedAtUtc?: string;
}): FhvT4CheckoutIdentityProofV1 {
  const verified = verifyFhvReleaseCheckoutIdentity({
    repoPath: input.repoPath,
    targetSha: input.targetSha,
    releaseTag: input.releaseTag,
  });
  const withoutDigest = {
    schemaVersion: FHV_T4_CHECKOUT_IDENTITY_SCHEMA_VERSION,
    repoPath: input.repoPath,
    releaseSha: input.targetSha.trim().toLowerCase(),
    releaseTag: input.releaseTag.trim(),
    headSha: verified.headSha,
    tagPeelSha: verified.tagPeelSha,
    trackedTreeClean: true as const,
    stagedChanges: false as const,
    mergeInProgress: false as const,
    runId: input.runId,
    organizationId: input.organizationId,
    capturedAtUtc: input.capturedAtUtc ?? new Date().toISOString(),
  };
  const proof: FhvT4CheckoutIdentityProofV1 = {
    ...withoutDigest,
    contentDigest: computePayloadDigest(withoutDigest),
  };
  const path = resolveFhvT4CheckoutIdentityPath(input.runRoot);
  if (existsSync(path)) {
    const existing = JSON.parse(readFileSync(path, "utf8")) as FhvT4CheckoutIdentityProofV1;
    const existingJson = `${JSON.stringify(existing, null, 2)}\n`;
    const nextJson = `${JSON.stringify(proof, null, 2)}\n`;
    if (existingJson !== nextJson) {
      throw new FhvT4CheckoutIdentityError(
        "FHV_T4_CHECKOUT_PROOF_OVERWRITE_FORBIDDEN",
        "Checkout identity proof already exists with different content.",
      );
    }
    const { contentDigest, ...without } = existing;
    if (computePayloadDigest(without) !== contentDigest) {
      throw new FhvT4CheckoutIdentityError(
        "FHV_T4_CHECKOUT_PROOF_DIGEST_INVALID",
        "Existing checkout identity proof digest invalid.",
      );
    }
    return existing;
  }
  writeFileAtomic(path, `${JSON.stringify(proof, null, 2)}\n`);
  return proof;
}

export function readFhvT4CheckoutIdentityProof(
  runRoot: string,
): FhvT4CheckoutIdentityProofV1 | null {
  const path = resolveFhvT4CheckoutIdentityPath(runRoot);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as FhvT4CheckoutIdentityProofV1;
}

export function verifyFhvT4CheckoutIdentityProofArtifact(input: {
  runRoot: string;
  targetSha: string;
  releaseTag: string;
  runId: string;
  organizationId: string;
}): FhvT4CheckoutIdentityProofV1 {
  const proof = readFhvT4CheckoutIdentityProof(input.runRoot);
  if (!proof) {
    throw new FhvT4CheckoutIdentityError(
      "FHV_T4_CHECKOUT_PROOF_MISSING",
      "Checkout identity proof is required.",
    );
  }
  const { contentDigest, ...withoutDigest } = proof;
  if (computePayloadDigest(withoutDigest) !== contentDigest) {
    throw new FhvT4CheckoutIdentityError(
      "FHV_T4_CHECKOUT_PROOF_DIGEST_MISMATCH",
      "Checkout identity proof contentDigest mismatch.",
    );
  }
  if (
    proof.releaseSha !== input.targetSha.trim().toLowerCase() ||
    proof.releaseTag !== input.releaseTag.trim() ||
    proof.runId !== input.runId ||
    proof.organizationId !== input.organizationId ||
    proof.headSha !== proof.releaseSha ||
    proof.tagPeelSha !== proof.releaseSha ||
    proof.trackedTreeClean !== true ||
    proof.stagedChanges !== false ||
    proof.mergeInProgress !== false
  ) {
    throw new FhvT4CheckoutIdentityError(
      "FHV_T4_CHECKOUT_PROOF_IDENTITY_MISMATCH",
      "Checkout identity proof identity/state mismatch.",
    );
  }
  return proof;
}
