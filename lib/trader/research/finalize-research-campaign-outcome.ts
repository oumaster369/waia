import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { isTransientConnectionError, withCampaignDbRetry } from "@/db/postgres-client";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import type { StreamingEvidenceManifestRef } from "@/lib/trader/backtest/streaming-evidence";
import type { ReplayRunTerminalState } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import type { CanonicalInventoryWalkResult } from "@/lib/trader/paper/derive-canonical-inventory";
import { PaperPnLReconciliationError } from "@/lib/trader/paper/paper-pnl.errors";
import {
  buildCampaignOperatorDiagnostics,
  serializeCampaignOperatorDiagnostics,
} from "@/lib/trader/research/build-campaign-operator-diagnostics";
import type { CampaignOperatorDiagnostics } from "@/lib/trader/research/campaign-operator-diagnostics.types";
import { buildEvolutionCycleMvp } from "@/lib/trader/research/build-evolution-cycle-mvp";
import type { EvolutionCycleMvp } from "@/lib/trader/research/evolution-cycle-mvp.types";
import type { ResearchPipelineRegimeFailureError } from "@/lib/trader/research/errors";
import { tryLoadCanonicalInventorySnapshot } from "@/lib/trader/research/load-campaign-inventory-snapshot";
import { createPlaceholderResearchValidationMetricsV2 } from "@/lib/trader/research/placeholder-research-validation-metrics";
import { buildResearchRejectionRecord } from "@/lib/trader/research/build-research-rejection-record";
import type {
  ResearchRejectionFailureCode,
  ResearchRejectionRecord,
} from "@/lib/trader/research/research-rejection-record.types";
import {
  getLatestCandidateForStrategyPostgres,
  updateStrategyCandidateStatusPostgres,
} from "@/lib/trader/research/strategy-candidate-repository-postgres";
import {
  writeCampaignFailureVaultArtifacts,
  type WriteCampaignFailureVaultArtifactsResult,
} from "@/lib/trader/research/write-campaign-failure-vault";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export type CampaignTerminationKind = "success" | "governed_reject" | "crash";

export type ResearchCampaignScope = {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  datasetId?: string;
  candidateId?: string;
  backtestRunId?: string;
  blindValidationResultId?: string;
  blindConsumed?: boolean;
  walkForwardWindowCount?: number;
};

export type FinalizeResearchCampaignOutcomeInput = {
  kind: CampaignTerminationKind;
  scope: ResearchCampaignScope;
  error?: unknown;
  governedReject?: ResearchPipelineRegimeFailureError;
  inventory?: Pick<CanonicalInventoryWalkResult, "openQtyBySymbol"> | null;
  parityStatus?: CampaignOperatorDiagnostics["recordBody"]["parityStatus"];
  parityMessage?: string | null;
  builderGitSha?: string | null;
  orderRepository?: OrderRepository;
  streamingManifestRef?: StreamingEvidenceManifestRef | null;
  replayTerminalState?: ReplayRunTerminalState | null;
};

export type FinalizeResearchCampaignOutcomeResult = {
  kind: CampaignTerminationKind;
  rejectionRecord?: ResearchRejectionRecord;
  operatorDiagnostics: CampaignOperatorDiagnostics;
  evolutionCycle?: EvolutionCycleMvp;
};

/**
 * Classifies a campaign termination error honestly (DEE-399). `PaperPnLReconciliationError`
 * remains a real accounting defect. A transient Postgres/network connection failure — the
 * class observed in Repeat M9 v0.1.7's `write CONNECTION_CLOSED …pooler.supabase.com:6543`
 * crash — is sealed as its own `CAMPAIGN_INFRA_DISCONNECT` code so an infrastructure blip is
 * never conflated with a generic/unknown pipeline crash. Everything else remains
 * `CAMPAIGN_CRASH`. This function only ever narrows the label; it never converts a failure
 * into success and never suppresses the underlying error.
 */
export function resolveResearchCampaignCrashFailureCode(
  error: unknown,
): ResearchRejectionFailureCode {
  if (error instanceof PaperPnLReconciliationError) {
    return "INVENTORY_RECONCILIATION";
  }
  if (isTransientConnectionError(error)) {
    return "CAMPAIGN_INFRA_DISCONNECT";
  }
  return "CAMPAIGN_CRASH";
}

function resolveFailureMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function resolveStreamingEvidenceDiagnostics(
  manifestRef: StreamingEvidenceManifestRef | null | undefined,
  outcomeKind: CampaignTerminationKind,
  replayTerminalState?: ReplayRunTerminalState | null,
): CampaignOperatorDiagnostics["recordBody"]["streamingEvidence"] {
  if (!manifestRef) {
    return null;
  }
  const { manifest, runDir } = manifestRef;
  const terminalState =
    outcomeKind === "success"
      ? manifest.terminalState === "STREAMING_EVIDENCE_OK"
        ? manifest.terminalState
        : "STREAMING_EVIDENCE_FAILED"
      : manifest.terminalState === "STREAMING_EVIDENCE_SEALED_PARTIAL"
        ? manifest.terminalState
        : manifest.terminalState;
  return {
    terminalState,
    chainDigest: manifest.chainDigest,
    expectedCycleCount: manifest.expectedCycleCount,
    sealedThroughCycleIndex: manifest.sealedThroughCycleIndex,
    runDir,
    replayTerminalState: replayTerminalState ?? null,
  };
}

async function buildGovernedRejectRejectionRecord(
  ex: PgWriteExecutor,
  context: OrgContext,
  failure: ResearchPipelineRegimeFailureError,
  builderGitSha?: string | null,
): Promise<ResearchRejectionRecord> {
  const rejectionRecord = buildResearchRejectionRecord({
    organizationId: failure.organizationId,
    strategyId: failure.strategyId,
    strategyVersion: failure.strategyVersion,
    candidateId: failure.candidateId,
    datasetId: failure.datasetId,
    backtestRunId: failure.backtestRunId,
    blindValidationResultId: failure.blindValidationResultId,
    failureCode: "MULTI_REGIME_COVERAGE_INSUFFICIENT",
    failureMessage: failure.message,
    blindConsumed: failure.blindConsumed,
    walkForwardWindowCount: failure.walkForwardWindowCount,
    validationMetrics: failure.validationMetrics,
    walkForwardMetrics: failure.walkForwardMetrics,
    blindMetrics: failure.blindMetrics,
    builderGitSha: builderGitSha ?? null,
  });

  // Resilient (DEE-399): a transient connection blip must not prevent sealing the honest
  // rejection artifact below. Best-effort only — if the candidate status write still fails
  // after bounded retry, the candidate row remains non-terminal for operator SQL cleanup
  // (see PR-1 plan §5); it never blocks or falsifies the local rejection/evolution artifact.
  await withCampaignDbRetry(() =>
    updateStrategyCandidateStatusPostgres(ex, context, failure.candidateId, "rejected"),
  ).catch(() => undefined);

  return rejectionRecord;
}

async function buildCrashRejectionRecord(
  ex: PgWriteExecutor,
  context: OrgContext,
  scope: ResearchCampaignScope,
  error: unknown,
  builderGitSha?: string | null,
): Promise<ResearchRejectionRecord> {
  const placeholderMetrics = createPlaceholderResearchValidationMetricsV2();
  let candidateId = scope.candidateId ?? "unknown";
  const datasetId = scope.datasetId ?? "unknown";
  const backtestRunId = scope.backtestRunId ?? "unknown";
  const blindValidationResultId = scope.blindValidationResultId ?? "unknown";
  let blindConsumed = scope.blindConsumed ?? false;
  const walkForwardWindowCount = scope.walkForwardWindowCount ?? 0;

  // Resilient (DEE-399): retry the read/write themselves, but never let an ultimately-failed
  // DB write escape and block sealing the honest local rejection/evolution/diagnostics
  // artifact — that is the primary failure mode PR-1 closes (a dead connection previously
  // prevented even the crash artifact from being written). A candidate left non-terminal
  // after exhausted retries is documented operator SQL cleanup (PR-1 plan §5), never silent.
  const candidate = await withCampaignDbRetry(() =>
    getLatestCandidateForStrategyPostgres(ex, context, scope.strategyId, scope.strategyVersion),
  ).catch(() => null);

  if (candidate) {
    candidateId = candidate.id;
    blindConsumed = candidate.blindUsed;
    await withCampaignDbRetry(() =>
      updateStrategyCandidateStatusPostgres(ex, context, candidate.id, "rejected"),
    ).catch(() => undefined);
  }

  return buildResearchRejectionRecord({
    organizationId: scope.organizationId,
    strategyId: scope.strategyId,
    strategyVersion: scope.strategyVersion,
    candidateId,
    datasetId,
    backtestRunId,
    blindValidationResultId,
    failureCode: resolveResearchCampaignCrashFailureCode(error),
    failureMessage: resolveFailureMessage(error),
    blindConsumed,
    walkForwardWindowCount,
    validationMetrics: placeholderMetrics,
    walkForwardMetrics: [],
    blindMetrics: placeholderMetrics,
    builderGitSha: builderGitSha ?? null,
  });
}

export async function finalizeResearchCampaignOutcomePostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: FinalizeResearchCampaignOutcomeInput,
): Promise<FinalizeResearchCampaignOutcomeResult> {
  const { scope, kind } = input;
  const streamingEvidence = resolveStreamingEvidenceDiagnostics(
    input.streamingManifestRef,
    kind,
    input.replayTerminalState,
  );

  if (
    kind === "success" &&
    input.replayTerminalState &&
    input.replayTerminalState !== "REPLAY_RUN_OK"
  ) {
    throw new Error("WP05_FALSE_SUCCESS: replay terminal state blocks success finalization");
  }

  if (kind === "success") {
    const operatorDiagnostics = buildCampaignOperatorDiagnostics({
      organizationId: scope.organizationId,
      strategyId: scope.strategyId,
      strategyVersion: scope.strategyVersion,
      outcomeKind: "success",
      inventory: input.inventory,
      parityStatus: input.parityStatus ?? "ok",
      parityMessage: input.parityMessage,
      builderGitSha: input.builderGitSha ?? null,
      streamingEvidence,
    });
    return { kind, operatorDiagnostics };
  }

  if (kind === "governed_reject" && input.governedReject) {
    const rejectionRecord = await buildGovernedRejectRejectionRecord(
      ex,
      context,
      input.governedReject,
      input.builderGitSha,
    );
    const operatorDiagnostics = buildCampaignOperatorDiagnostics({
      organizationId: scope.organizationId,
      strategyId: scope.strategyId,
      strategyVersion: scope.strategyVersion,
      outcomeKind: "governed_reject",
      error: input.governedReject,
      inventory: input.inventory,
      parityStatus: input.parityStatus ?? "not_checked",
      parityMessage: input.parityMessage,
      builderGitSha: input.builderGitSha ?? null,
      streamingEvidence,
    });
    const evolutionCycle = buildEvolutionCycleMvp({ rejectionRecord });
    return { kind, rejectionRecord, operatorDiagnostics, evolutionCycle };
  }

  let inventory = input.inventory;
  if (!inventory && input.orderRepository) {
    // Best-effort (DEE-399): an inventory snapshot failure must never block sealing the
    // rejection/evolution/diagnostics artifact — `parityStatus` already models "not_checked"
    // for exactly this case.
    inventory = await withCampaignDbRetry(() =>
      tryLoadCanonicalInventorySnapshot(ex, context, {
        orderRepository: input.orderRepository!,
      }),
    ).catch(() => null);
  }

  const error = input.error ?? new Error("Campaign crash");
  const rejectionRecord = await buildCrashRejectionRecord(
    ex,
    context,
    scope,
    error,
    input.builderGitSha,
  );

  const operatorDiagnostics = buildCampaignOperatorDiagnostics({
    organizationId: scope.organizationId,
    strategyId: scope.strategyId,
    strategyVersion: scope.strategyVersion,
    outcomeKind: "crash",
    error,
    inventory,
    parityStatus: input.parityStatus ?? "not_checked",
    parityMessage: input.parityMessage,
    builderGitSha: input.builderGitSha ?? null,
    streamingEvidence,
  });

  const evolutionCycle = buildEvolutionCycleMvp({ rejectionRecord });

  return { kind, rejectionRecord, operatorDiagnostics, evolutionCycle };
}

export type SealResearchCampaignOutcomeArtifactsInput = {
  vaultDir: string;
  trackId?: "A" | "B";
  naming?: "track" | "flat";
  rejectionBasename?: string;
  evolutionBasename?: string;
  diagnosticsBasename?: string;
  outcome: FinalizeResearchCampaignOutcomeResult;
  manifest?: unknown;
  manifestBasename?: string;
};

export type SealResearchCampaignOutcomeArtifactsResult = {
  rejectionRecordPath: string | null;
  evolutionCyclePath: string | null;
  operatorDiagnosticsPath: string;
  manifestPath?: string;
};

export function sealResearchCampaignOutcomeArtifacts(
  input: SealResearchCampaignOutcomeArtifactsInput,
): SealResearchCampaignOutcomeArtifactsResult {
  const diagnosticsBasename = input.diagnosticsBasename ?? "campaign-operator-diagnostics.json";
  const diagnosticsPath = resolve(input.vaultDir, diagnosticsBasename);

  mkdirSync(input.vaultDir, { recursive: true });
  writeFileSync(
    diagnosticsPath,
    serializeCampaignOperatorDiagnostics(input.outcome.operatorDiagnostics),
    "utf8",
  );

  let failureArtifacts: WriteCampaignFailureVaultArtifactsResult | null = null;
  if (input.outcome.rejectionRecord && input.outcome.evolutionCycle) {
    failureArtifacts = writeCampaignFailureVaultArtifacts({
      vaultDir: input.vaultDir,
      trackId: input.trackId,
      naming: input.naming,
      rejectionBasename: input.rejectionBasename,
      evolutionBasename: input.evolutionBasename,
      diagnosticsBasename: input.diagnosticsBasename,
      rejectionRecord: input.outcome.rejectionRecord,
      evolutionCycle: input.outcome.evolutionCycle,
      operatorDiagnostics: input.outcome.operatorDiagnostics,
    });
  }

  let manifestPath: string | undefined;
  if (input.manifest) {
    manifestPath = resolve(input.vaultDir, input.manifestBasename ?? "m9-campaign-manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(input.manifest, null, 2)}\n`, "utf8");
  }

  return {
    rejectionRecordPath: failureArtifacts?.rejectionRecordPath ?? null,
    evolutionCyclePath: failureArtifacts?.evolutionCyclePath ?? null,
    operatorDiagnosticsPath: failureArtifacts?.operatorDiagnosticsPath ?? diagnosticsPath,
    manifestPath,
  };
}
