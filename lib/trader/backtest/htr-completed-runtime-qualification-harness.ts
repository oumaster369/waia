import path from "node:path";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  D11B_APPROVED_HOST_FINGERPRINT_SHA256,
  readQualificationHarnessSha256,
  runWp09AmendedQualificationAttempt,
  verifyReferenceHostFingerprint,
} from "@/lib/trader/backtest/replay-qualification-harness";
import { readGitCodeSha, readGitDirtyTree } from "@/lib/trader/backtest/replay-benchmark-harness";
import type {
  HtrWp22CompletedRuntimeQualificationResult,
  HtrWp22CompletedRuntimeQualificationTerminalState,
} from "@/lib/trader/backtest/htr-completed-runtime-qualification.types";
import {
  HTR_WP22_COMPLETED_RUNTIME_D11B_PHASE,
  HTR_WP22_COMPLETED_RUNTIME_QUALIFICATION_SCHEMA,
} from "@/lib/trader/backtest/htr-completed-runtime-qualification.types";
import { HTR_WP22_EVIDENCE_STAGING_ROOT } from "@/lib/trader/backtest/htr-wp22-evidence-harness";

export const HTR_WP22_COMPLETED_RUNTIME_D11B_STAGING_SUBDIR = "completed-runtime-d11b";

function resolveCompletedRuntimeStagingDir(sourceGitSha: string, stagingDir?: string): string {
  return (
    stagingDir ??
    path.join(
      HTR_WP22_EVIDENCE_STAGING_ROOT,
      sourceGitSha,
      HTR_WP22_COMPLETED_RUNTIME_D11B_STAGING_SUBDIR,
    )
  );
}

function mapQualificationTerminalState(
  qualificationTerminalState: string,
): HtrWp22CompletedRuntimeQualificationTerminalState {
  if (qualificationTerminalState === "HTR_WP09_D11B_MEMORY_AMENDMENT_V1_PASS") {
    return "HTR_WP22_COMPLETED_RUNTIME_D11B_PASS";
  }
  if (qualificationTerminalState === "HTR_WP09_D11B_MEMORY_AMENDMENT_V1_THRESHOLDS_NOT_MET") {
    return "HTR_WP22_COMPLETED_RUNTIME_D11B_THRESHOLDS_NOT_MET";
  }
  return "HTR_WP22_COMPLETED_RUNTIME_D11B_ATTEMPT_INVALIDATED";
}

export async function runHtrWp22CompletedRuntimeD11bQualification(input: {
  sourceGitSha: string;
  stagingDir?: string;
}): Promise<HtrWp22CompletedRuntimeQualificationResult> {
  verifyReferenceHostFingerprint(D11B_APPROVED_HOST_FINGERPRINT_SHA256);

  const gitSha = readGitCodeSha();
  const dirtyTree = readGitDirtyTree();
  const hostFingerprintSha256 = D11B_APPROVED_HOST_FINGERPRINT_SHA256;

  if (dirtyTree) {
    return {
      schemaVersion: HTR_WP22_COMPLETED_RUNTIME_QUALIFICATION_SCHEMA,
      phase: HTR_WP22_COMPLETED_RUNTIME_D11B_PHASE,
      terminalState: "HTR_WP22_COMPLETED_RUNTIME_D11B_ATTEMPT_INVALIDATED",
      sourceGitSha: input.sourceGitSha,
      sourceDirtyTree: true,
      hostFingerprintSha256,
      d11bThresholdsBinding: "D11B_THRESHOLDS_UNCHANGED",
      qualificationHarnessSha256: readQualificationHarnessSha256(),
      qualificationAttempt: {
        schemaVersion: "htr-wp09-canvas-runtime-qualification/v1",
        terminalState: "HTR_WP09_D11B_MEMORY_AMENDMENT_V1_ATTEMPT_INVALIDATED",
        activeQualificationContract: "D11B_MEMORY_GATE_AMENDMENT_V1",
        gitSha,
        dirtyTree: true,
        hostFingerprintSha256,
        datasetSha256: "",
        n1: {} as never,
        n2: {} as never,
        hostPreflight: {} as never,
        invalidationReason: "qualificationDirtyTree=true",
      },
      invalidationReason: "sourceDirtyTree=true",
    };
  }

  if (gitSha !== input.sourceGitSha) {
    return {
      schemaVersion: HTR_WP22_COMPLETED_RUNTIME_QUALIFICATION_SCHEMA,
      phase: HTR_WP22_COMPLETED_RUNTIME_D11B_PHASE,
      terminalState: "HTR_WP22_COMPLETED_RUNTIME_D11B_ATTEMPT_INVALIDATED",
      sourceGitSha: input.sourceGitSha,
      sourceDirtyTree: false,
      hostFingerprintSha256,
      d11bThresholdsBinding: "D11B_THRESHOLDS_UNCHANGED",
      qualificationHarnessSha256: readQualificationHarnessSha256(),
      qualificationAttempt: {
        schemaVersion: "htr-wp09-canvas-runtime-qualification/v1",
        terminalState: "HTR_WP09_D11B_MEMORY_AMENDMENT_V1_ATTEMPT_INVALIDATED",
        activeQualificationContract: "D11B_MEMORY_GATE_AMENDMENT_V1",
        gitSha,
        dirtyTree: false,
        hostFingerprintSha256,
        datasetSha256: "",
        n1: {} as never,
        n2: {} as never,
        hostPreflight: {} as never,
        invalidationReason: "sourceGitShaMismatch",
      },
      invalidationReason: `sourceGitShaMismatch:expected=${input.sourceGitSha}:actual=${gitSha}`,
    };
  }

  const qualificationAttempt = await runWp09AmendedQualificationAttempt({
    stagingDir: resolveCompletedRuntimeStagingDir(input.sourceGitSha, input.stagingDir),
  });

  const terminalState = mapQualificationTerminalState(qualificationAttempt.terminalState);
  const semanticBody = {
    schemaVersion: HTR_WP22_COMPLETED_RUNTIME_QUALIFICATION_SCHEMA,
    phase: HTR_WP22_COMPLETED_RUNTIME_D11B_PHASE,
    terminalState,
    sourceGitSha: input.sourceGitSha,
    sourceDirtyTree: false,
    hostFingerprintSha256,
    d11bThresholdsBinding: "D11B_THRESHOLDS_UNCHANGED" as const,
    qualificationHarnessSha256: readQualificationHarnessSha256(),
    qualificationAttempt,
  };

  return {
    ...semanticBody,
    payloadSha256: computeSemanticSha256Hex(semanticBody),
  };
}
