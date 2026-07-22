import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { readReplayCheckpoint } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { readReplayRunChainManifest } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import type { FhvOperatorAction } from "@/lib/trader/observability/fhv-observability.constants";
import { isFhvCampaignControlRequestPending } from "@/lib/trader/observability/fhv-control-request-validator";
import {
  readFhvRehearsalCampaignProgress,
  readFhvRehearsalTerminalClassification,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import { readFhvOperatorStatusTolerant } from "@/lib/trader/observability/fhv-status-writer";
import { validateFhvCampaignHeartbeat } from "@/lib/trader/observability/fhv-campaign-heartbeat";

export type FhvCampaignLifecycleState =
  | "NOT_STARTED"
  | "STARTING"
  | "RUNNING"
  | "PAUSE_REQUESTED"
  | "PAUSED_RESUMABLE"
  | "RESUME_REQUESTED"
  | "RESUMING"
  | "COMPLETED_OK"
  | "TIMED_OUT"
  | "FAILED_NONRESUMABLE"
  | "STOPPED"
  | "INCONSISTENT";

export type FhvCampaignStateSnapshot = Readonly<{
  state: FhvCampaignLifecycleState;
  phase: string;
  checkpointSeq: number | undefined;
  terminalClassification: string | null;
  progressPhase: string | null;
  replayTerminalState: string | null;
}>;

export class FhvCampaignStateTransitionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvCampaignStateTransitionError";
  }
}

export function resolveFhvCampaignState(input: {
  runRoot: string;
  runId: string;
  organizationId: string;
  nowMs?: number;
}): FhvCampaignStateSnapshot {
  const terminal = readFhvRehearsalTerminalClassification(input.runRoot);
  const progress = readFhvRehearsalCampaignProgress(input.runRoot);
  const checkpoint = readReplayCheckpoint(input.runRoot);
  const status = readFhvOperatorStatusTolerant(input.runRoot);
  const runChain = readReplayRunChainManifest(input.runRoot);
  const heartbeat = validateFhvCampaignHeartbeat({
    runRoot: input.runRoot,
    organizationId: input.organizationId,
    runId: input.runId,
    nowMs: input.nowMs,
  });

  const pausePending = isFhvCampaignControlRequestPending({
    runRoot: input.runRoot,
    action: "PAUSE_AT_CHECKPOINT",
    runId: input.runId,
    organizationId: input.organizationId,
  });
  const resumePending = isFhvCampaignControlRequestPending({
    runRoot: input.runRoot,
    action: "RESUME_FROM_CHECKPOINT",
    runId: input.runId,
    organizationId: input.organizationId,
  });

  const phase =
    progress?.phase ?? status?.campaign.phase ?? checkpoint?.activePhase ?? "validation";
  const checkpointSeq =
    checkpoint?.safeResumeThroughCycleIndex !== undefined
      ? checkpoint.safeResumeThroughCycleIndex + 1
      : undefined;

  if (
    terminal === "REHEARSAL_OK" ||
    runChain?.segments.some((s) => s.terminalState === "STREAMING_EVIDENCE_OK")
  ) {
    return {
      state: "COMPLETED_OK",
      phase,
      checkpointSeq,
      terminalClassification: terminal,
      progressPhase: progress?.phase ?? "completed",
      replayTerminalState: checkpoint?.replayTerminalState ?? "REPLAY_RUN_OK",
    };
  }
  if (terminal === "REHEARSAL_TIMEOUT") {
    return {
      state: "TIMED_OUT",
      phase,
      checkpointSeq,
      terminalClassification: terminal,
      progressPhase: progress?.phase ?? "timeout",
      replayTerminalState: checkpoint?.replayTerminalState ?? null,
    };
  }
  if (terminal === "REHEARSAL_PAUSED" || progress?.phase === "paused_at_checkpoint") {
    return {
      state: resumePending ? "RESUME_REQUESTED" : "PAUSED_RESUMABLE",
      phase,
      checkpointSeq,
      terminalClassification: terminal,
      progressPhase: progress?.phase ?? "paused_at_checkpoint",
      replayTerminalState: checkpoint?.replayTerminalState ?? "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE",
    };
  }
  if (pausePending) {
    return {
      state: "PAUSE_REQUESTED",
      phase,
      checkpointSeq,
      terminalClassification: terminal,
      progressPhase: progress?.phase ?? "running",
      replayTerminalState: checkpoint?.replayTerminalState ?? null,
    };
  }
  if (progress?.phase === "running" || heartbeat.ok) {
    return {
      state: "RUNNING",
      phase,
      checkpointSeq,
      terminalClassification: terminal,
      progressPhase: progress?.phase ?? "running",
      replayTerminalState: checkpoint?.replayTerminalState ?? null,
    };
  }
  if (progress?.phase === "timeout") {
    return {
      state: "TIMED_OUT",
      phase,
      checkpointSeq,
      terminalClassification: terminal ?? "REHEARSAL_TIMEOUT",
      progressPhase: progress.phase,
      replayTerminalState: checkpoint?.replayTerminalState ?? null,
    };
  }
  if (existsSync(join(input.runRoot, "fhv-rehearsal-campaign-progress.v1.json"))) {
    return {
      state: "STARTING",
      phase,
      checkpointSeq,
      terminalClassification: terminal,
      progressPhase: progress?.phase ?? null,
      replayTerminalState: checkpoint?.replayTerminalState ?? null,
    };
  }
  return {
    state: "NOT_STARTED",
    phase,
    checkpointSeq,
    terminalClassification: terminal,
    progressPhase: progress?.phase ?? null,
    replayTerminalState: checkpoint?.replayTerminalState ?? null,
  };
}

const ALLOWED_TRANSITIONS: Record<FhvOperatorAction, readonly FhvCampaignLifecycleState[]> = {
  PAUSE_AT_CHECKPOINT: ["RUNNING", "PAUSE_REQUESTED", "STARTING"],
  RESUME_FROM_CHECKPOINT: ["PAUSED_RESUMABLE", "RESUME_REQUESTED"],
  GRACEFUL_STOP: ["RUNNING", "PAUSE_REQUESTED", "STARTING", "PAUSED_RESUMABLE", "RESUME_REQUESTED"],
  EMERGENCY_STOP: [
    "RUNNING",
    "PAUSE_REQUESTED",
    "STARTING",
    "PAUSED_RESUMABLE",
    "RESUME_REQUESTED",
    "RESUMING",
  ],
  CREATE_DIAGNOSTIC_BUNDLE: [
    "NOT_STARTED",
    "RUNNING",
    "PAUSE_REQUESTED",
    "PAUSED_RESUMABLE",
    "RESUME_REQUESTED",
    "COMPLETED_OK",
    "TIMED_OUT",
    "FAILED_NONRESUMABLE",
    "STOPPED",
  ],
};

export function assertFhvCampaignActionAllowed(input: {
  action: FhvOperatorAction;
  snapshot: FhvCampaignStateSnapshot;
}): void {
  const allowed = ALLOWED_TRANSITIONS[input.action];
  if (!allowed.includes(input.snapshot.state)) {
    throw new FhvCampaignStateTransitionError(
      "FHV_CAMPAIGN_ACTION_NOT_ALLOWED",
      `Action ${input.action} not allowed in state ${input.snapshot.state}.`,
    );
  }
}

export function assertFhvResumePreconditions(input: {
  runRoot: string;
  runId: string;
  organizationId: string;
  snapshot: FhvCampaignStateSnapshot;
}): void {
  assertFhvCampaignActionAllowed({ action: "RESUME_FROM_CHECKPOINT", snapshot: input.snapshot });
  if (input.snapshot.terminalClassification === "REHEARSAL_OK") {
    throw new FhvCampaignStateTransitionError(
      "FHV_RESUME_AFTER_OK",
      "Cannot resume completed campaign.",
    );
  }
  if (input.snapshot.terminalClassification === "REHEARSAL_TIMEOUT") {
    throw new FhvCampaignStateTransitionError(
      "FHV_RESUME_AFTER_TIMEOUT",
      "Cannot resume timed-out campaign.",
    );
  }
  const checkpoint = readReplayCheckpoint(input.runRoot);
  if (!checkpoint) {
    throw new FhvCampaignStateTransitionError(
      "FHV_RESUME_CHECKPOINT_MISSING",
      "Checkpoint missing for resume.",
    );
  }
  if (checkpoint.backtestRunId !== input.runId) {
    throw new FhvCampaignStateTransitionError(
      "FHV_RESUME_RUN_MISMATCH",
      "Checkpoint runId mismatch.",
    );
  }
  if (checkpoint.replayTerminalState !== "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE") {
    throw new FhvCampaignStateTransitionError(
      "FHV_RESUME_NOT_RESUMABLE",
      "Checkpoint is not resumable.",
    );
  }
}

export function readFhvHostTimeoutMarker(runRoot: string): boolean {
  const path = join(runRoot, "fhv-host-timeout.v1.json");
  if (!existsSync(path)) {
    return false;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { classification?: string };
    return parsed.classification === "REHEARSAL_TIMEOUT";
  } catch {
    return false;
  }
}
