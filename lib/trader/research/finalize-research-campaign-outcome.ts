import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
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
};

export type FinalizeResearchCampaignOutcomeResult = {
  kind: CampaignTerminationKind;
  rejectionRecord?: ResearchRejectionRecord;
  operatorDiagnostics: CampaignOperatorDiagnostics;
  evolutionCycle?: EvolutionCycleMvp;
};

export function resolveResearchCampaignCrashFailureCode(
  error: unknown,
): ResearchRejectionFailureCode {
  if (error instanceof PaperPnLReconciliationError) {
    return "INVENTORY_RECONCILIATION";
  }
  return "CAMPAIGN_CRASH";
}

function resolveFailureMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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

  await updateStrategyCandidateStatusPostgres(ex, context, failure.candidateId, "rejected");

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

  const candidate = await getLatestCandidateForStrategyPostgres(
    ex,
    context,
    scope.strategyId,
    scope.strategyVersion,
  ).catch(() => null);

  if (candidate) {
    candidateId = candidate.id;
    blindConsumed = candidate.blindUsed;
    await updateStrategyCandidateStatusPostgres(ex, context, candidate.id, "rejected");
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
    });
    const evolutionCycle = buildEvolutionCycleMvp({ rejectionRecord });
    return { kind, rejectionRecord, operatorDiagnostics, evolutionCycle };
  }

  let inventory = input.inventory;
  if (!inventory && input.orderRepository) {
    inventory = await tryLoadCanonicalInventorySnapshot(ex, context, {
      orderRepository: input.orderRepository,
    });
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
