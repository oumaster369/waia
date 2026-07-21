import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { readReplayCheckpoint } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { reconstructStreamingEvidence } from "@/lib/trader/backtest/streaming-evidence";
import {
  appendFhvAlertLedger,
  paginateFhvAlertLedger,
} from "@/lib/trader/observability/fhv-alert-ledger";
import {
  dedupeFhvAlerts,
  evaluateFhvObserverAlerts,
  FHV_ALERT_CATALOGUE_V1,
} from "@/lib/trader/observability/fhv-alert-catalogue.v1";
import { FHV_ALERT_POLICY_BASELINE_FHV_V1 } from "@/lib/trader/observability/fhv-alert-policy-v1";
import {
  appendFhvCommandLedger,
  findFhvCommandResultByIdempotencyKey,
  loadFhvCommandLedgerNonces,
  writeFhvCommandResult,
  type FhvCommandResultV1,
} from "@/lib/trader/observability/fhv-command-ledger";
import { collectFhvHostTelemetry } from "@/lib/trader/observability/fhv-host-telemetry";
import {
  FhvCommandVerificationError,
  verifyFhvOperatorCommandV1,
  type FhvOperatorCommandV1,
} from "@/lib/trader/observability/fhv-operator-command-v1";
import { buildFhvOperatorStatusV1 } from "@/lib/trader/observability/build-fhv-operator-status-v1";
import {
  buildAndWriteFhvOperatorStatus,
  readFhvOperatorStatusTolerant,
} from "@/lib/trader/observability/fhv-status-writer";
import { deliverFhvAlertWithRetry } from "@/lib/trader/observability/fhv-telegram-delivery";
import { validateFhvCampaignHeartbeat } from "@/lib/trader/observability/fhv-campaign-heartbeat";
import {
  initializeFhvObserverProgressState,
  persistFhvObserverProgressFromTick,
} from "@/lib/trader/observability/fhv-observer-progress-state";
import {
  measureBoundedDirectoryBytes,
  resolveCampaignTerminalState,
  resolveCheckpointWrittenAtUtc,
} from "@/lib/trader/observability/fhv-telemetry-probes";
import {
  UNCONFIGURED_FHV_CAMPAIGN_CONTROL_EXECUTOR,
  type FhvCampaignControlExecutor,
} from "@/lib/trader/observability/fhv-campaign-control-executor";

export type FhvObserverConfig = Readonly<{
  runRoot: string;
  runId: string;
  organizationId: string;
  commandSecret: string;
  observerTunnelSecret: string;
  bindHost?: string;
  port?: number;
  campaignControlExecutor?: FhvCampaignControlExecutor;
  pinnedBarsTotal?: number | null;
}>;

export type FhvObserverTickInput = Readonly<{
  nowMs?: number;
  barsProcessed?: number;
  barsTotal?: number;
  phase?: string;
  startedAt?: string;
  processRestartCount?: number;
  heartbeatAt?: string;
  terminalState?: string;
  sendTelegram?: (text: string) => Promise<{ ok: boolean; error?: string }>;
}>;

export type FhvObserverTickResult = Readonly<{
  statusWritten: boolean;
  alertsFired: readonly string[];
  hostSafetyEscalation: boolean;
}>;

export function readFhvCampaignCheckpoint(runRoot: string) {
  try {
    return readReplayCheckpoint(runRoot);
  } catch {
    return null;
  }
}

export function readFhvEvidenceHealth(runRoot: string): "ok" | "degraded" | "failed" {
  const evidenceDir = join(runRoot, "streaming-evidence");
  if (!existsSync(evidenceDir)) {
    return "degraded";
  }
  try {
    reconstructStreamingEvidence(evidenceDir);
    return "ok";
  } catch {
    return "failed";
  }
}

export function createFhvObserverState(config: FhvObserverConfig) {
  const persisted = initializeFhvObserverProgressState({
    runRoot: config.runRoot,
    runId: config.runId,
    organizationId: config.organizationId,
  });
  const lastProgressMs = persisted.lastProgressAtUtc
    ? Date.parse(persisted.lastProgressAtUtc)
    : persisted.restoredConservatively
      ? 0
      : Date.now();
  return {
    config,
    lastFiredAtById: new Map<string, number>(),
    telegramDedupe: new Set<string>(),
    lastBarsProcessed: persisted.lastBarsProcessed,
    lastProgressMs: Number.isFinite(lastProgressMs) ? lastProgressMs : 0,
    lastRestartCount: persisted.processRestartCount,
    lastHeartbeatSequence: persisted.lastHeartbeatSequence,
    restoredConservatively: persisted.restoredConservatively,
  };
}

export type FhvObserverState = ReturnType<typeof createFhvObserverState>;

export async function runFhvObserverTick(
  state: FhvObserverState,
  input: FhvObserverTickInput = {},
): Promise<FhvObserverTickResult> {
  const nowMs = input.nowMs ?? Date.now();
  const observedAt = new Date(nowMs).toISOString();
  const checkpoint = readFhvCampaignCheckpoint(state.config.runRoot);
  const checkpointPath = join(state.config.runRoot, "replay-checkpoint.json");
  const checkpointWrittenAt = resolveCheckpointWrittenAtUtc(checkpointPath);
  const hostTelemetry = collectFhvHostTelemetry({
    runRoot: state.config.runRoot,
    filesystemPath: state.config.runRoot,
    postgresConnectivity: "unknown",
    datasetReadable: null,
  });

  const barsProcessed = input.barsProcessed ?? checkpoint?.evidenceDurableThroughCycleIndex ?? 0;
  const barsTotal = input.barsTotal ?? state.config.pinnedBarsTotal ?? null;
  if (barsProcessed > state.lastBarsProcessed) {
    state.lastBarsProcessed = barsProcessed;
    state.lastProgressMs = nowMs;
    state.restoredConservatively = false;
  }
  const stallSec =
    state.lastProgressMs > 0
      ? Math.floor((nowMs - state.lastProgressMs) / 1000)
      : state.restoredConservatively
        ? 9999
        : 0;

  const heartbeatValidation = validateFhvCampaignHeartbeat({
    runRoot: state.config.runRoot,
    organizationId: state.config.organizationId,
    runId: state.config.runId,
    nowMs,
    lastSeenSequence: state.lastHeartbeatSequence ?? undefined,
  });
  const heartbeatAgeSec = heartbeatValidation.ok ? heartbeatValidation.heartbeatAgeSec : 9999;
  if (heartbeatValidation.ok) {
    state.lastHeartbeatSequence = heartbeatValidation.heartbeat.heartbeatSequence;
  }
  const checkpointAgeSec = checkpointWrittenAt
    ? Math.floor((nowMs - Date.parse(checkpointWrittenAt)) / 1000)
    : null;

  const processRestartCount = input.processRestartCount ?? 0;
  if (processRestartCount > state.lastRestartCount) {
    state.lastRestartCount = processRestartCount;
  }

  const policy = FHV_ALERT_POLICY_BASELINE_FHV_V1;
  const rawAlerts = evaluateFhvObserverAlerts({
    policy,
    heartbeatAgeSec,
    stallSec,
    checkpointAgeSec,
    diskSoftBreached: hostTelemetry.diskSoftBreached,
    diskHardBreached: hostTelemetry.diskHardBreached,
    postgresDownSec: 0,
    processRestartCount,
  });
  const alertsFired = dedupeFhvAlerts(rawAlerts, state.lastFiredAtById, nowMs);

  for (const alertId of alertsFired) {
    const entry = FHV_ALERT_CATALOGUE_V1.find((e) => e.id === alertId);
    appendFhvAlertLedger(state.config.runRoot, {
      alertId,
      severity: entry?.severity ?? "WARNING",
      firedAtUtc: observedAt,
      message: entry?.condition ?? alertId,
      detector: entry?.detector ?? "Observer",
      dedupeKey: `${alertId}:${Math.floor(nowMs / ((entry?.dedupeSec ?? 60) * 1000))}`,
    });
    if (input.sendTelegram) {
      await deliverFhvAlertWithRetry({
        entry: {
          alertId,
          severity: entry?.severity ?? "WARNING",
          firedAtUtc: observedAt,
          message: entry?.condition ?? alertId,
          detector: "Observer",
          dedupeKey: alertId,
        },
        send: input.sendTelegram,
        dedupeSeen: state.telegramDedupe,
      });
    }
  }

  const evidenceHealth = readFhvEvidenceHealth(state.config.runRoot);
  let hostSafetyEscalation = false;
  if (hostTelemetry.diskHardBreached) {
    const executor =
      state.config.campaignControlExecutor ?? UNCONFIGURED_FHV_CAMPAIGN_CONTROL_EXECUTOR;
    const enforcement = await executor.execute({
      action: "EMERGENCY_STOP",
      runId: state.config.runId,
      organizationId: state.config.organizationId,
      operatorId: "observer-host-safety",
      reason: "Disk hard threshold breached",
    });
    hostSafetyEscalation = enforcement.enforcementApplied;
  }

  buildAndWriteFhvOperatorStatus(state.config.runRoot, {
    observedAt,
    organizationId: state.config.organizationId,
    runId: state.config.runId,
    phase: input.phase ?? checkpoint?.activePhase ?? "validation",
    codeSha: checkpoint?.codeSha ?? "unknown",
    artifactDigest: checkpoint?.checkpointDigest ?? "unknown",
    datasetSeal: checkpoint?.datasetContentDigest ?? "unknown",
    datasetDigest: checkpoint?.datasetContentDigest ?? "unknown",
    configurationDigest: checkpoint?.checkpointDigest ?? "unknown",
    barsProcessed,
    barsTotal: barsTotal ?? undefined,
    startedAt: input.startedAt ?? observedAt,
    lastCheckpointAt: checkpointWrittenAt,
    heartbeatAt: heartbeatValidation.ok ? heartbeatValidation.heartbeat.heartbeatAtUtc : null,
    heartbeatState: heartbeatValidation.ok ? "OK" : heartbeatValidation.heartbeatState,
    heartbeatAgeMs: heartbeatValidation.ok ? heartbeatValidation.heartbeatAgeSec * 1000 : null,
    processRestartCount,
    terminalState: resolveCampaignTerminalState({
      explicitTerminalState: input.terminalState ?? null,
      checkpointTerminalState: checkpoint?.replayTerminalState ?? null,
      campaignRunning: !checkpoint?.replayTerminalState,
    }),
    terminalReason: null,
    checkpoint,
    hostTelemetry,
    evidenceHealth,
    recentAlerts: alertsFired.map((alertId) => ({
      id: alertId,
      label: alertId,
      atUtc: observedAt,
      artifactRef: `fhv-artifact/v1/alert/${state.config.runId}/${alertId}#0`,
    })),
  });

  persistFhvObserverProgressFromTick({
    runRoot: state.config.runRoot,
    runId: state.config.runId,
    organizationId: state.config.organizationId,
    lastBarsProcessed: state.lastBarsProcessed,
    lastProgressAtUtc:
      state.lastProgressMs > 0 ? new Date(state.lastProgressMs).toISOString() : null,
    lastHeartbeatSequence: state.lastHeartbeatSequence,
    processRestartCount: state.lastRestartCount,
    restoredConservatively: state.restoredConservatively,
  });

  void measureBoundedDirectoryBytes;

  return { statusWritten: true, alertsFired, hostSafetyEscalation };
}

export async function handleFhvObserverCommand(
  state: FhvObserverState,
  command: FhvOperatorCommandV1,
  source: "worker_tunnel" | "local_break_glass" | "test" = "worker_tunnel",
  options?: { nowMs?: number },
): Promise<FhvCommandResultV1> {
  const existing = findFhvCommandResultByIdempotencyKey(
    state.config.runRoot,
    command.idempotencyKey,
  );
  if (existing) {
    return { ...existing, status: "duplicate" };
  }

  const status = readFhvOperatorStatusTolerant(state.config.runRoot);
  const checkpoint = readFhvCampaignCheckpoint(state.config.runRoot);
  const ledger = loadFhvCommandLedgerNonces(state.config.runRoot);

  try {
    verifyFhvOperatorCommandV1({
      command,
      secret: state.config.commandSecret,
      expectedRunId: state.config.runId,
      expectedOrganizationId: state.config.organizationId,
      currentPhase: status?.campaign.phase ?? checkpoint?.activePhase ?? "validation",
      currentCheckpointSeq: undefined,
      seenNonces: ledger.nonces,
      seenIdempotencyKeys: ledger.idempotencyKeys,
      nowMs: options?.nowMs,
    });
  } catch (error) {
    const message =
      error instanceof FhvCommandVerificationError ? error.message : "Command rejected";
    const result: FhvCommandResultV1 = {
      schemaVersion: "fhv-command-result/v1",
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      status: "rejected",
      message,
      completedAtUtc: new Date().toISOString(),
      enforcementApplied: false,
    };
    appendFhvCommandLedger(state.config.runRoot, {
      recordedAtUtc: result.completedAtUtc,
      command,
      source,
    });
    writeFhvCommandResult(state.config.runRoot, result);
    return result;
  }

  const executor =
    state.config.campaignControlExecutor ?? UNCONFIGURED_FHV_CAMPAIGN_CONTROL_EXECUTOR;
  const execution = await executor.execute({
    action: command.action,
    runId: state.config.runId,
    organizationId: state.config.organizationId,
    operatorId: command.operatorId,
    reason: command.reason,
  });

  const result: FhvCommandResultV1 = {
    schemaVersion: "fhv-command-result/v1",
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    status:
      execution.message === "SUPERVISOR_NOT_CONFIGURED"
        ? "rejected"
        : execution.outcome === "executed"
          ? "executed"
          : "failed",
    message: execution.message,
    completedAtUtc: new Date().toISOString(),
    enforcementApplied: execution.enforcementApplied,
  };
  appendFhvCommandLedger(state.config.runRoot, {
    recordedAtUtc: result.completedAtUtc,
    command,
    source,
  });
  writeFhvCommandResult(state.config.runRoot, result);
  return result;
}

export function buildFhvObserverStatusSnapshot(state: FhvObserverState) {
  return readFhvOperatorStatusTolerant(state.config.runRoot);
}

export function buildFhvObserverDetailPage(
  runRoot: string,
  kind: string,
  cursor: string | null,
  limit: number,
): { items: readonly unknown[]; nextCursor: string | null } {
  if (kind === "alerts") {
    return paginateFhvAlertLedger(runRoot, cursor, limit);
  }
  return { items: [], nextCursor: null };
}
