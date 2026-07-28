/**
 * DEE-436 — recovery namespace safety and audited local-release verification.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

import { FhvT4aOperatorError } from "@/lib/trader/observability/fhv-t4a-operator-errors";
import type { FhvT4aOperatorTransport } from "@/lib/trader/observability/fhv-t4a-operator-transport";
import {
  fhvT4aPhaseReceiptPath,
  readFhvT4aLocalReleaseReceipt,
} from "@/lib/trader/observability/fhv-t4a-phase-receipts";
import type { FhvT4aResidualRecoveryBindings } from "@/lib/trader/observability/fhv-t4a-residual-recovery-operator";

const RECOVERY_SCRIPT_PATH = "scripts/ops/fhv-t4-supervisor-residual-recovery.sh";

const T4A_PHASE_RECEIPTS = [
  "fhv-t4a-preauth-receipt.v1.json",
  "fhv-t4a-post-before-receipt.v1.json",
  "fhv-t4a-post-finalize-receipt.v1.json",
] as const;

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function assertFhvT4aRecoveryNamespaceSafe(recovery: FhvT4aResidualRecoveryBindings): void {
  if (!recovery.recoveryId.trim()) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_ID_REQUIRED",
      "FHV_T4A_RESIDUAL_RECOVERY_ID is required.",
    );
  }
  if (recovery.recoveryId === recovery.failedRunId) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_NAMESPACE_ID_COLLISION",
      "Recovery operation ID must differ from the failed T4A run ID.",
    );
  }
  const normalizedState = recovery.localStateDir.replace(/\\/g, "/");
  const failedRunSegment = recovery.failedRunId.replace(/\\/g, "/");
  if (
    normalizedState.endsWith(`/${failedRunSegment}`) ||
    normalizedState.includes(`/${failedRunSegment}/`) ||
    normalizedState.includes(`/t4a/${failedRunSegment}`)
  ) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_NAMESPACE_FAILED_RUN_COLLISION",
      "Recovery local state must not reuse a failed T4A run namespace.",
    );
  }
  for (const name of T4A_PHASE_RECEIPTS) {
    if (existsSync(fhvT4aPhaseReceiptPath(recovery.localStateDir, name))) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_RESIDUAL_RECOVERY_NAMESPACE_T4A_RECEIPT_PRESENT",
        `T4A phase receipt ${name} must not exist in recovery namespace.`,
      );
    }
  }
}

export function verifyFhvT4aRecoveryLocalReleaseGit(
  recovery: FhvT4aResidualRecoveryBindings,
  transport: FhvT4aOperatorTransport,
): void {
  const checks: Array<[string, readonly string[]]> = [
    ["status", ["status", "--porcelain=v1"]],
    ["head", ["rev-parse", "HEAD"]],
    ["tag-peel", ["rev-parse", `${recovery.implementationReleaseTag}^{}`]],
    ["origin", ["remote", "get-url", "origin"]],
  ];
  for (const [label, args] of checks) {
    const result = transport.localGit(args);
    if (result.exitCode !== 0) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_RESIDUAL_RECOVERY_LOCAL_RELEASE_VERIFY_FAILED",
        `Recovery local release verify failed: ${label}`,
      );
    }
    if (label === "status" && result.stdout.trim()) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_RESIDUAL_RECOVERY_LOCAL_RELEASE_DIRTY",
        "Recovery implementation checkout tracked tree/index is not clean.",
      );
    }
    if (
      label === "head" &&
      result.stdout.trim().toLowerCase() !== recovery.implementationTargetSha
    ) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_RESIDUAL_RECOVERY_IMPLEMENTATION_SHA_MISMATCH",
        "FHV_LOCAL_RELEASE_ROOT HEAD must equal EXECUTION_SERVER_TARGET_SHA.",
      );
    }
    if (
      label === "tag-peel" &&
      result.stdout.trim().toLowerCase() !== recovery.implementationTargetSha
    ) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_RESIDUAL_RECOVERY_TAG_PEEL_MISMATCH",
        "Release tag peel must equal EXECUTION_SERVER_TARGET_SHA.",
      );
    }
    if (label === "origin" && result.stdout.trim() !== recovery.originUrl) {
      throw new FhvT4aOperatorError(
        "FHV_T4A_RESIDUAL_RECOVERY_ORIGIN_MISMATCH",
        "Local origin must equal FHV_ORIGIN_URL.",
      );
    }
  }
}

export function assertFhvT4aRecoveryLocalReleaseReceipt(
  recovery: FhvT4aResidualRecoveryBindings,
): void {
  const receipt = readFhvT4aLocalReleaseReceipt(recovery.localStateDir);
  if (receipt.targetSha.toLowerCase() !== recovery.implementationTargetSha) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_LOCAL_RELEASE_RECEIPT_SHA_MISMATCH",
      "Local release receipt targetSha mismatch.",
    );
  }
  if (receipt.releaseTag !== recovery.implementationReleaseTag) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_LOCAL_RELEASE_RECEIPT_TAG_MISMATCH",
      "Local release receipt releaseTag mismatch.",
    );
  }
  if (receipt.originUrl !== recovery.originUrl) {
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_LOCAL_RELEASE_RECEIPT_ORIGIN_MISMATCH",
      "Local release receipt originUrl mismatch.",
    );
  }
}

export function assertFhvT4aRecoveryImplementationRelease(input: {
  recovery: FhvT4aResidualRecoveryBindings;
  transport: FhvT4aOperatorTransport;
}): { recoveryScriptDigest: string } {
  const { recovery, transport } = input;
  assertFhvT4aRecoveryNamespaceSafe(recovery);
  verifyFhvT4aRecoveryLocalReleaseGit(recovery, transport);
  assertFhvT4aRecoveryLocalReleaseReceipt(recovery);
  let implementationScriptBody: string;
  try {
    implementationScriptBody = transport.gitShowBlob(
      recovery.implementationTargetSha,
      RECOVERY_SCRIPT_PATH,
    );
  } catch {
    throw new FhvT4aOperatorError(
      "FHV_T4A_RESIDUAL_RECOVERY_IMPLEMENTATION_SCRIPT_MISSING",
      "Recovery implementation SHA does not contain the audited recovery script.",
    );
  }
  return { recoveryScriptDigest: sha256Hex(implementationScriptBody) };
}
