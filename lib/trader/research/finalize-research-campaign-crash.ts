import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { CanonicalInventoryWalkResult } from "@/lib/trader/paper/derive-canonical-inventory";
import { PaperPnLReconciliationError } from "@/lib/trader/paper/paper-pnl.errors";
import { buildCampaignOperatorDiagnostics } from "@/lib/trader/research/build-campaign-operator-diagnostics";
import type { CampaignOperatorDiagnostics } from "@/lib/trader/research/campaign-operator-diagnostics.types";
import { buildEvolutionCycleMvp } from "@/lib/trader/research/build-evolution-cycle-mvp";
import type { EvolutionCycleMvp } from "@/lib/trader/research/evolution-cycle-mvp.types";
import { buildResearchRejectionRecord } from "@/lib/trader/research/build-research-rejection-record";
import { createPlaceholderResearchValidationMetricsV2 } from "@/lib/trader/research/placeholder-research-validation-metrics";
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

export type ResearchCampaignCrashScope = {
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

export type FinalizeResearchCampaignCrashInput = {
  scope: ResearchCampaignCrashScope;
  error: unknown;
  inventory?: Pick<CanonicalInventoryWalkResult, "openQtyBySymbol"> | null;
  builderGitSha?: string | null;
};

export type FinalizeResearchCampaignCrashResult = {
  rejectionRecord: ResearchRejectionRecord;
  operatorDiagnostics: CampaignOperatorDiagnostics;
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

export async function finalizeResearchCampaignCrashPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: FinalizeResearchCampaignCrashInput,
): Promise<FinalizeResearchCampaignCrashResult> {
  const { scope } = input;
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

  const failureCode = resolveResearchCampaignCrashFailureCode(input.error);
  const rejectionRecord = buildResearchRejectionRecord({
    organizationId: scope.organizationId,
    strategyId: scope.strategyId,
    strategyVersion: scope.strategyVersion,
    candidateId,
    datasetId,
    backtestRunId,
    blindValidationResultId,
    failureCode,
    failureMessage: resolveFailureMessage(input.error),
    blindConsumed,
    walkForwardWindowCount,
    validationMetrics: placeholderMetrics,
    walkForwardMetrics: [],
    blindMetrics: placeholderMetrics,
    builderGitSha: input.builderGitSha ?? null,
  });

  const operatorDiagnostics = buildCampaignOperatorDiagnostics({
    organizationId: scope.organizationId,
    strategyId: scope.strategyId,
    strategyVersion: scope.strategyVersion,
    error: input.error,
    inventory: input.inventory,
    builderGitSha: input.builderGitSha ?? null,
  });

  return { rejectionRecord, operatorDiagnostics };
}

export type SealResearchCampaignCrashArtifactsInput = {
  vaultDir: string;
  trackId?: "A" | "B";
  naming?: "track" | "flat";
  rejectionBasename?: string;
  evolutionBasename?: string;
  diagnosticsBasename?: string;
  rejectionRecord: ResearchRejectionRecord;
  operatorDiagnostics: CampaignOperatorDiagnostics;
  evolutionCycle?: EvolutionCycleMvp;
};

export type SealResearchCampaignCrashArtifactsResult = WriteCampaignFailureVaultArtifactsResult;

export function sealResearchCampaignCrashArtifacts(
  input: SealResearchCampaignCrashArtifactsInput,
): SealResearchCampaignCrashArtifactsResult {
  const evolutionCycle =
    input.evolutionCycle ??
    buildEvolutionCycleMvp({
      rejectionRecord: input.rejectionRecord,
    });
  const artifactPaths = writeCampaignFailureVaultArtifacts({
    vaultDir: input.vaultDir,
    trackId: input.trackId,
    naming: input.naming,
    rejectionBasename: input.rejectionBasename,
    evolutionBasename: input.evolutionBasename,
    rejectionRecord: input.rejectionRecord,
    evolutionCycle,
    operatorDiagnostics: input.operatorDiagnostics,
    diagnosticsBasename: input.diagnosticsBasename,
  });

  return artifactPaths;
}
