import { existsSync, readFileSync, statSync } from "node:fs";
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
  statFhvOperatorStatusMtime,
} from "@/lib/trader/observability/fhv-status-writer";
import { deliverFhvAlertWithRetry } from "@/lib/trader/observability/fhv-telegram-delivery";
import { FHV_SUPERVISOR_NEUTRAL_CONTRACT } from "@/lib/trader/observability/fhv-supervisor-contract";

export type FhvObserverConfig = Readonly<{
  runRoot: string;
  runId: string;
  organizationId: string;
  commandSecret: string;
  bindHost?: string;
  port?: number;
}>;

export type FhvObserverTickInput = Readonly<{
  nowMs?: number;
  barsProcessed?: number;
  barsTotal?: number;
  phase?: string;
  startedAt?: string;
  processRestartCount?: number;
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
  const lastFiredAtById = new Map<string, number>();
  const telegramDedupe = new Set<string>();
  const lastBarsProcessed = 0;
  const lastProgressMs = Date.now();
  const lastRestartCount = 0;

  return {
    config,
    lastFiredAtById,
    telegramDedupe,
    lastBarsProcessed,
    lastProgressMs,
    lastRestartCount,
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
  const hostTelemetry = collectFhvHostTelemetry({
    artifactDirBytes: safeDirSize(state.config.runRoot),
    postgresConnectivity: "unknown",
    datasetReadable: false,
  });

  const barsProcessed = input.barsProcessed ?? checkpoint?.evidenceDurableThroughCycleIndex ?? 0;
  const barsTotal = input.barsTotal ?? barsProcessed;
  if (barsProcessed > state.lastBarsProcessed) {
    state.lastBarsProcessed = barsProcessed;
    state.lastProgressMs = nowMs;
  }
  const stallSec = Math.floor((nowMs - state.lastProgressMs) / 1000);
  const statusMtime = statFhvOperatorStatusMtime(state.config.runRoot);
  const heartbeatAgeSec = statusMtime !== null ? Math.floor((nowMs - statusMtime) / 1000) : 9999;
  const checkpointAgeSec = null;

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
  buildAndWriteFhvOperatorStatus(state.config.runRoot, {
    observedAt,
    runId: state.config.runId,
    phase: input.phase ?? checkpoint?.activePhase ?? "validation",
    codeSha: checkpoint?.codeSha ?? "unknown",
    artifactDigest: checkpoint?.checkpointDigest ?? "unknown",
    datasetSeal: checkpoint?.datasetContentDigest ?? "unknown",
    datasetDigest: checkpoint?.datasetContentDigest ?? "unknown",
    configurationDigest: checkpoint?.checkpointDigest ?? "unknown",
    barsProcessed,
    barsTotal,
    startedAt: input.startedAt ?? observedAt,
    lastCheckpointAt: null,
    heartbeatAt: observedAt,
    processRestartCount,
    terminalState: checkpoint?.replayTerminalState ?? "REPLAY_RUN_OK",
    terminalReason: null,
    checkpoint,
    hostTelemetry,
    recentAlerts: alertsFired.map((alertId) => ({
      id: alertId,
      label: alertId,
      atUtc: observedAt,
      artifactRef: `fhv-artifact/v1/alert/${state.config.runId}/${alertId}#0`,
    })),
  });

  const hostSafetyEscalation = hostTelemetry.diskHardBreached;
  void evidenceHealth;
  void FHV_SUPERVISOR_NEUTRAL_CONTRACT;

  return { statusWritten: true, alertsFired, hostSafetyEscalation };
}

export function handleFhvObserverCommand(
  state: FhvObserverState,
  command: FhvOperatorCommandV1,
  source: "worker_tunnel" | "local_break_glass" | "test" = "worker_tunnel",
): FhvCommandResultV1 {
  const existing = findFhvCommandResultByIdempotencyKey(
    state.config.runRoot,
    command.idempotencyKey,
  );
  if (existing) {
    return existing;
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
    };
    appendFhvCommandLedger(state.config.runRoot, {
      recordedAtUtc: result.completedAtUtc,
      command,
      source,
    });
    writeFhvCommandResult(state.config.runRoot, result);
    return result;
  }

  const result: FhvCommandResultV1 = {
    schemaVersion: "fhv-command-result/v1",
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    status: "accepted",
    message: `Command ${command.action} accepted for supervisor enforcement`,
    completedAtUtc: new Date().toISOString(),
  };
  appendFhvCommandLedger(state.config.runRoot, {
    recordedAtUtc: result.completedAtUtc,
    command,
    source,
  });
  writeFhvCommandResult(state.config.runRoot, result);
  return result;
}

function safeDirSize(runRoot: string): number | null {
  try {
    return statSync(runRoot).size;
  } catch {
    return null;
  }
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
