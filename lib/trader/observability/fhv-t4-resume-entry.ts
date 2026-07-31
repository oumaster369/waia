/**
 * DEE-436 — T4 deterministic pause resume campaign entry gate (fail-closed).
 */

import { readReplayCheckpoint } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { ReplayCheckpointError } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import {
  readFhvCommandLedgerEntries,
  readFhvCommandResult,
} from "@/lib/trader/observability/fhv-command-ledger";
import { isFhvCampaignControlRequestPending } from "@/lib/trader/observability/fhv-control-request-validator";
import { FHV_REHEARSAL_CHECKPOINT_CYCLE } from "@/lib/trader/observability/fhv-observability.constants";
import type { FhvRehearsalLaunchConfigV1 } from "@/lib/trader/observability/fhv-rehearsal-launcher";
import {
  readFhvRehearsalCampaignProgress,
  readFhvRehearsalTerminalClassification,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import {
  assertFhvT4PauseArmedBeforeCampaignStart,
  FhvT4DeterministicPauseError,
  isFhvT4DeterministicPauseManifest,
  readFhvT4PauseArmedRecord,
} from "@/lib/trader/observability/fhv-t4-deterministic-pause";
import {
  FHV_T4_PAUSED_PROOF_CLASSIFICATION,
  readFhvT4PausedVerificationProof,
  verifyFhvT4PausedVerificationProofArtifact,
} from "@/lib/trader/observability/fhv-t4-paused-final-proofs";

export function isFhvT4ResumeCampaignStartPending(input: {
  runRoot: string;
  manifest: FhvRehearsalLaunchConfigV1;
}): boolean {
  if (!isFhvT4DeterministicPauseManifest(input.manifest)) {
    return false;
  }
  return isFhvCampaignControlRequestPending({
    runRoot: input.runRoot,
    action: "RESUME_FROM_CHECKPOINT",
    runId: input.manifest.runId,
    organizationId: input.manifest.organizationId,
  });
}

export function assertFhvT4ResumeEntryBeforeCampaignStart(input: {
  runRoot: string;
  manifest: FhvRehearsalLaunchConfigV1;
  targetSha: string;
  releaseTag?: string;
}): void {
  if (!isFhvT4DeterministicPauseManifest(input.manifest)) {
    return;
  }

  if (
    !isFhvCampaignControlRequestPending({
      runRoot: input.runRoot,
      action: "RESUME_FROM_CHECKPOINT",
      runId: input.manifest.runId,
      organizationId: input.manifest.organizationId,
    })
  ) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_RESUME_REQUEST_MISSING",
      "Pending RESUME_FROM_CHECKPOINT control request required for resume campaign start.",
    );
  }

  const armed = readFhvT4PauseArmedRecord(input.runRoot);
  if (!armed) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_PAUSE_NOT_ARMED",
      "T4 deterministic pause armed record required for resume campaign start.",
    );
  }
  if (
    armed.runId !== input.manifest.runId ||
    armed.organizationId !== input.manifest.organizationId
  ) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_ARMED_IDENTITY_MISMATCH",
      "Armed record identity mismatch for resume campaign start.",
    );
  }
  if (armed.targetSha !== input.manifest.targetSha) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_ARMED_SHA_MISMATCH",
      "Armed record targetSha mismatch for resume campaign start.",
    );
  }

  const terminal = readFhvRehearsalTerminalClassification(input.runRoot);
  if (terminal !== "REHEARSAL_PAUSED") {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_RESUME_TERMINAL_INVALID",
      "Resume campaign start requires REHEARSAL_PAUSED terminal state.",
    );
  }

  const progress = readFhvRehearsalCampaignProgress(input.runRoot);
  if (progress?.phase !== "paused_at_checkpoint") {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_RESUME_PROGRESS_INVALID",
      "Resume campaign start requires paused_at_checkpoint progress phase.",
    );
  }

  const pausedProof = readFhvT4PausedVerificationProof(input.runRoot);
  if (!pausedProof || pausedProof.classification !== FHV_T4_PAUSED_PROOF_CLASSIFICATION) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_PAUSED_PROOF_MISSING",
      "Paused verification proof required for resume campaign start.",
    );
  }

  const releaseTag = input.releaseTag?.trim() || pausedProof.releaseTag;
  verifyFhvT4PausedVerificationProofArtifact({
    runRoot: input.runRoot,
    targetSha: input.targetSha,
    releaseTag,
    runId: input.manifest.runId,
    organizationId: input.manifest.organizationId,
  });

  const checkpoint = (() => {
    try {
      return readReplayCheckpoint(input.runRoot);
    } catch (error) {
      if (error instanceof ReplayCheckpointError) {
        throw new FhvT4DeterministicPauseError(
          "FHV_T4_RESUME_CHECKPOINT_MISSING",
          "Checkpoint required for resume campaign start.",
        );
      }
      throw error;
    }
  })();
  if (!checkpoint) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_RESUME_CHECKPOINT_MISSING",
      "Checkpoint required for resume campaign start.",
    );
  }
  if (checkpoint.safeResumeThroughCycleIndex !== FHV_REHEARSAL_CHECKPOINT_CYCLE - 1) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_RESUME_CHECKPOINT_FRONTIER_INVALID",
      `Resume checkpoint frontier must be cycle ${FHV_REHEARSAL_CHECKPOINT_CYCLE - 1}.`,
    );
  }
  if (checkpoint.safeResumeThroughCycleIndex !== checkpoint.evidenceDurableThroughCycleIndex) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_RESUME_EVIDENCE_FRONTIER_MISMATCH",
      "Safe resume frontier must match evidence durable frontier.",
    );
  }
  if (progress.cyclesProcessed !== checkpoint.safeResumeThroughCycleIndex + 1) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_RESUME_PROGRESS_FRONTIER_MISMATCH",
      "Progress frontier mismatch at resume campaign start.",
    );
  }

  const resumeEntries = readFhvCommandLedgerEntries(input.runRoot).filter(
    (entry) => entry.command.action === "RESUME_FROM_CHECKPOINT",
  );
  const resumeEntry = resumeEntries.at(-1);
  if (!resumeEntry) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_RESUME_LEDGER_MISSING",
      "Accepted RESUME_FROM_CHECKPOINT ledger entry required.",
    );
  }
  if (
    resumeEntry.command.campaignRunId !== input.manifest.runId ||
    resumeEntry.command.organizationId !== input.manifest.organizationId
  ) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_RESUME_LEDGER_IDENTITY_MISMATCH",
      "RESUME ledger identity mismatch.",
    );
  }
  const resumeResult = readFhvCommandResult(input.runRoot, resumeEntry.command.commandId);
  if (!resumeResult || resumeResult.status !== "accepted") {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_RESUME_NOT_ACCEPTED",
      "RESUME command result must be accepted before resume campaign start.",
    );
  }
}

export function assertFhvT4CampaignEntryBeforeStart(input: {
  runRoot: string;
  manifest: FhvRehearsalLaunchConfigV1;
  targetSha: string;
  releaseTag?: string;
}): void {
  if (!isFhvT4DeterministicPauseManifest(input.manifest)) {
    return;
  }
  if (isFhvT4ResumeCampaignStartPending(input)) {
    assertFhvT4ResumeEntryBeforeCampaignStart(input);
    return;
  }
  assertFhvT4PauseArmedBeforeCampaignStart({ runRoot: input.runRoot, manifest: input.manifest });
}
