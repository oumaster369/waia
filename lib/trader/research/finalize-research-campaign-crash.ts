import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { CanonicalInventoryWalkResult } from "@/lib/trader/paper/derive-canonical-inventory";
import type { CampaignOperatorDiagnostics } from "@/lib/trader/research/campaign-operator-diagnostics.types";
import { buildEvolutionCycleMvp } from "@/lib/trader/research/build-evolution-cycle-mvp";
import type { EvolutionCycleMvp } from "@/lib/trader/research/evolution-cycle-mvp.types";
import {
  finalizeResearchCampaignOutcomePostgres,
  resolveResearchCampaignCrashFailureCode,
  sealResearchCampaignOutcomeArtifacts,
} from "@/lib/trader/research/finalize-research-campaign-outcome";
import type { ResearchRejectionRecord } from "@/lib/trader/research/research-rejection-record.types";
import type { WriteCampaignFailureVaultArtifactsResult } from "@/lib/trader/research/write-campaign-failure-vault";
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

export { resolveResearchCampaignCrashFailureCode };

export async function finalizeResearchCampaignCrashPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: FinalizeResearchCampaignCrashInput,
): Promise<FinalizeResearchCampaignCrashResult> {
  const outcome = await finalizeResearchCampaignOutcomePostgres(ex, context, {
    kind: "crash",
    scope: input.scope,
    error: input.error,
    inventory: input.inventory,
    builderGitSha: input.builderGitSha ?? null,
  });

  if (!outcome.rejectionRecord) {
    throw new Error("[research] crash outcome missing rejection record");
  }

  return {
    rejectionRecord: outcome.rejectionRecord,
    operatorDiagnostics: outcome.operatorDiagnostics,
  };
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

  const paths = sealResearchCampaignOutcomeArtifacts({
    vaultDir: input.vaultDir,
    trackId: input.trackId,
    naming: input.naming,
    rejectionBasename: input.rejectionBasename,
    evolutionBasename: input.evolutionBasename,
    diagnosticsBasename: input.diagnosticsBasename,
    outcome: {
      kind: "crash",
      rejectionRecord: input.rejectionRecord,
      operatorDiagnostics: input.operatorDiagnostics,
      evolutionCycle,
    },
  });

  return {
    rejectionRecordPath: paths.rejectionRecordPath!,
    evolutionCyclePath: paths.evolutionCyclePath!,
    operatorDiagnosticsPath: paths.operatorDiagnosticsPath,
  };
}
