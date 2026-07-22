import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  canvasStateContentDigest,
  readCanvasStateSidecar,
} from "@/lib/trader/market-data/canvas/market-canvas-serialization";
import {
  HTR_WP03_BENCHMARK_FIXTURE_SHA256,
  loadApprovedBenchmarkFixture,
} from "@/lib/trader/backtest/replay-benchmark-harness";
import {
  readReplayCheckpoint,
  resolveEvidenceFrontier,
  type ReplayCheckpointRecord,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { reconstructStreamingEvidence } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-reconstructor";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import { assertFhvTargetSha } from "@/lib/trader/observability/fhv-campaign-runtime-identity";
import { isFhvCanonicalRunChainComplete } from "@/lib/trader/observability/fhv-canonical-run-chain";
import type { FhvRehearsalLaunchConfigV1 } from "@/lib/trader/observability/fhv-rehearsal-launcher";
import { readFhvCampaignControlRequest } from "@/lib/trader/observability/fhv-control-request-validator";
import {
  readFhvRehearsalCampaignProgress,
  resolveFhvRehearsalEvidenceDir,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import {
  assertFhvCampaignIdentityFrontierPresent,
  FhvCampaignIdentityError,
} from "@/lib/trader/observability/fhv-campaign-identity";

export type FhvResumeIdentityErrorCode =
  | "FHV_RESUME_CHECKPOINT_MISSING"
  | "FHV_RESUME_CHECKPOINT_DIGEST_INVALID"
  | "FHV_RESUME_RUN_ID_MISMATCH"
  | "FHV_RESUME_CODE_SHA_MISMATCH"
  | "FHV_RESUME_FIXTURE_SHA_MISMATCH"
  | "FHV_RESUME_DATASET_DIGEST_MISMATCH"
  | "FHV_RESUME_DATASET_ID_MISMATCH"
  | "FHV_RESUME_REPLAY_TERMINAL_NOT_RESUMABLE"
  | "FHV_RESUME_EVIDENCE_TERMINAL_NOT_PARTIAL"
  | "FHV_RESUME_EVIDENCE_DIR_MISMATCH"
  | "FHV_RESUME_EVIDENCE_CHAIN_MISMATCH"
  | "FHV_RESUME_EVIDENCE_FRONTIER_MISMATCH"
  | "FHV_RESUME_PROGRESS_FRONTIER_MISMATCH"
  | "FHV_RESUME_CANVAS_SIDECAR_MISSING"
  | "FHV_RESUME_CANVAS_DIGEST_INVALID"
  | "FHV_RESUME_CONTROL_REQUEST_INVALID"
  | "FHV_RESUME_ORG_MISMATCH"
  | "FHV_RESUME_TARGET_SHA_MISMATCH"
  | "FHV_RESUME_RUN_CHAIN_ALREADY_COMPLETE"
  | "FHV_RESUME_IDENTITY_FRONTIER_MISSING"
  | "FHV_RESUME_IDENTITY_FRONTIER_MISMATCH"
  | "FHV_RESUME_IDENTITY_FRONTIER_ROLLBACK";

export class FhvResumeIdentityError extends Error {
  constructor(
    readonly code: FhvResumeIdentityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FhvResumeIdentityError";
  }
}

const APPROVED_DATASET_ID = "fhv-rehearsal-wp03";

export function assertFhvRehearsalResumeIdentity(input: {
  runRoot: string;
  manifest: FhvRehearsalLaunchConfigV1;
  targetSha: string;
}): ReplayCheckpointRecord {
  if (isFhvCanonicalRunChainComplete(input.runRoot)) {
    throw new FhvResumeIdentityError(
      "FHV_RESUME_RUN_CHAIN_ALREADY_COMPLETE",
      "Authoritative run-chain already complete.",
    );
  }

  const checkpoint = readReplayCheckpoint(input.runRoot);
  if (!checkpoint) {
    throw new FhvResumeIdentityError(
      "FHV_RESUME_CHECKPOINT_MISSING",
      "Checkpoint missing for resume.",
    );
  }

  const expectedTargetSha = assertFhvTargetSha(input.targetSha);
  if (checkpoint.backtestRunId !== input.manifest.runId) {
    throw new FhvResumeIdentityError("FHV_RESUME_RUN_ID_MISMATCH", "Checkpoint runId mismatch.");
  }
  if (input.manifest.targetSha !== expectedTargetSha) {
    throw new FhvResumeIdentityError(
      "FHV_RESUME_TARGET_SHA_MISMATCH",
      "Manifest targetSha mismatch.",
    );
  }
  if (checkpoint.codeSha !== input.manifest.targetSha) {
    throw new FhvResumeIdentityError(
      "FHV_RESUME_CODE_SHA_MISMATCH",
      "Checkpoint codeSha mismatch.",
    );
  }
  if (checkpoint.fixtureSha256 !== HTR_WP03_BENCHMARK_FIXTURE_SHA256) {
    throw new FhvResumeIdentityError(
      "FHV_RESUME_FIXTURE_SHA_MISMATCH",
      "Checkpoint fixtureSha256 mismatch.",
    );
  }
  const fixture = loadApprovedBenchmarkFixture();
  const datasetDigest = computeBarSetDigest(fixture.bars);
  if (checkpoint.datasetContentDigest !== datasetDigest) {
    throw new FhvResumeIdentityError(
      "FHV_RESUME_DATASET_DIGEST_MISMATCH",
      "Checkpoint dataset digest mismatch.",
    );
  }
  if (checkpoint.datasetId !== APPROVED_DATASET_ID) {
    throw new FhvResumeIdentityError(
      "FHV_RESUME_DATASET_ID_MISMATCH",
      "Checkpoint datasetId mismatch.",
    );
  }
  if (checkpoint.replayTerminalState !== "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE") {
    throw new FhvResumeIdentityError(
      "FHV_RESUME_REPLAY_TERMINAL_NOT_RESUMABLE",
      "Checkpoint replay terminal is not resumable.",
    );
  }

  const expectedPartialDir = resolve(resolveFhvRehearsalEvidenceDir(input.runRoot));
  const checkpointEvidenceDir = resolve(checkpoint.evidenceRunDir);
  if (checkpointEvidenceDir !== expectedPartialDir) {
    throw new FhvResumeIdentityError(
      "FHV_RESUME_EVIDENCE_DIR_MISMATCH",
      "Checkpoint evidenceRunDir mismatch.",
    );
  }
  if (!existsSync(expectedPartialDir)) {
    throw new FhvResumeIdentityError(
      "FHV_RESUME_EVIDENCE_DIR_MISMATCH",
      "Partial evidence directory missing.",
    );
  }

  const evidence = resolveEvidenceFrontier(expectedPartialDir);
  if (evidence.evidenceTerminalState !== "STREAMING_EVIDENCE_SEALED_PARTIAL") {
    throw new FhvResumeIdentityError(
      "FHV_RESUME_EVIDENCE_TERMINAL_NOT_PARTIAL",
      "Partial evidence is not sealed partial.",
    );
  }
  const reconstruction = reconstructStreamingEvidence(expectedPartialDir);
  if (reconstruction.chainDigest !== checkpoint.evidenceChainDigest) {
    throw new FhvResumeIdentityError(
      "FHV_RESUME_EVIDENCE_CHAIN_MISMATCH",
      "Checkpoint evidence chain digest mismatch.",
    );
  }
  if (checkpoint.evidenceDurableThroughCycleIndex !== evidence.evidenceDurableThroughCycleIndex) {
    throw new FhvResumeIdentityError(
      "FHV_RESUME_EVIDENCE_FRONTIER_MISMATCH",
      "Checkpoint evidence frontier mismatch.",
    );
  }
  if (checkpoint.safeResumeThroughCycleIndex !== checkpoint.evidenceDurableThroughCycleIndex) {
    throw new FhvResumeIdentityError(
      "FHV_RESUME_EVIDENCE_FRONTIER_MISMATCH",
      "Safe resume frontier mismatch.",
    );
  }

  const progress = readFhvRehearsalCampaignProgress(input.runRoot);
  if (progress && progress.cyclesProcessed - 1 !== checkpoint.safeResumeThroughCycleIndex) {
    throw new FhvResumeIdentityError(
      "FHV_RESUME_PROGRESS_FRONTIER_MISMATCH",
      "Progress frontier mismatch.",
    );
  }

  if (!checkpoint.canvasStateRef) {
    throw new FhvResumeIdentityError(
      "FHV_RESUME_CANVAS_SIDECAR_MISSING",
      "Canvas sidecar missing from checkpoint.",
    );
  }
  const canvas = readCanvasStateSidecar(input.runRoot, checkpoint.canvasStateRef);
  if (!canvas || canvasStateContentDigest(canvas).length === 0) {
    throw new FhvResumeIdentityError(
      "FHV_RESUME_CANVAS_DIGEST_INVALID",
      "Canvas sidecar digest invalid.",
    );
  }

  const controlRequest = readFhvCampaignControlRequest({
    runRoot: input.runRoot,
    action: "RESUME_FROM_CHECKPOINT",
    runId: input.manifest.runId,
    organizationId: input.manifest.organizationId,
  });
  if (!controlRequest) {
    throw new FhvResumeIdentityError(
      "FHV_RESUME_CONTROL_REQUEST_INVALID",
      "Resume control request missing.",
    );
  }
  if (controlRequest.organizationId !== input.manifest.organizationId) {
    throw new FhvResumeIdentityError("FHV_RESUME_ORG_MISMATCH", "Control request org mismatch.");
  }

  try {
    assertFhvCampaignIdentityFrontierPresent(checkpoint);
  } catch (error) {
    if (error instanceof FhvCampaignIdentityError) {
      const code =
        error.code === "FHV_CAMPAIGN_IDENTITY_FRONTIER_MISSING"
          ? "FHV_RESUME_IDENTITY_FRONTIER_MISSING"
          : error.code === "FHV_CAMPAIGN_IDENTITY_FRONTIER_ROLLBACK"
            ? "FHV_RESUME_IDENTITY_FRONTIER_ROLLBACK"
            : "FHV_RESUME_IDENTITY_FRONTIER_MISMATCH";
      throw new FhvResumeIdentityError(code, error.message);
    }
    throw error;
  }

  return checkpoint;
}
