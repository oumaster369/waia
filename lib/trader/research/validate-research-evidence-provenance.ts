import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { getBacktestRunByIdPostgres } from "@/lib/trader/backtest/backtest-repository-postgres";
import { getResearchDatasetByIdPostgres } from "@/lib/trader/market-data/research-dataset-repository-postgres";
import { ResearchEvidenceProvenanceError } from "@/lib/trader/research/errors";
import type { ResearchEvidenceDocument } from "@/lib/trader/research/research-evidence-export.types";
import { hasSufficientResearchRegimeCoverage } from "@/lib/trader/research/serialize-research-evidence-export";
import {
  getBlindValidationResultForCandidatePostgres,
  getStrategyCandidateByIdPostgres,
  listWalkForwardWindowsForCandidatePostgres,
} from "@/lib/trader/research/strategy-candidate-repository-postgres";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;

export type ValidatedResearchEvidenceProvenance = {
  datasetId: string;
  backtestRunId: string;
  strategyCandidateId: string;
  blindValidationResultId: string;
};

export type ValidateResearchEvidenceProvenanceOptions = Readonly<{
  requireRegimeCoverage?: boolean;
}>;

/**
 * Loads and cross-checks every artifact referenced by a research evidence document
 * against persisted Postgres state. Rejects fabricated or mismatched UUIDs.
 */
export async function validateResearchEvidenceProvenancePostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  document: ResearchEvidenceDocument,
  options?: ValidateResearchEvidenceProvenanceOptions,
): Promise<ValidatedResearchEvidenceProvenance> {
  const body = document.evidenceBody;
  const envelope = document.envelope;
  const requireRegimeCoverage = options?.requireRegimeCoverage ?? true;

  if (body.executionMode !== "backtest") {
    throw new ResearchEvidenceProvenanceError("RESEARCH_EVIDENCE_MODE_INVALID");
  }

  if (requireRegimeCoverage && !hasSufficientResearchRegimeCoverage(body.regimeCoverage)) {
    throw new ResearchEvidenceProvenanceError("RESEARCH_EVIDENCE_REGIME_COVERAGE_INSUFFICIENT");
  }

  const dataset = await getResearchDatasetByIdPostgres(ex, context, body.datasetId);
  if (!dataset) {
    throw new ResearchEvidenceProvenanceError("RESEARCH_EVIDENCE_DATASET_NOT_FOUND");
  }

  const backtestRun = await getBacktestRunByIdPostgres(ex, context, body.backtestRunId);
  if (!backtestRun) {
    throw new ResearchEvidenceProvenanceError("RESEARCH_EVIDENCE_BACKTEST_RUN_NOT_FOUND");
  }

  if (backtestRun.datasetId !== dataset.id) {
    throw new ResearchEvidenceProvenanceError("RESEARCH_EVIDENCE_BACKTEST_DATASET_MISMATCH");
  }

  if (backtestRun.strategyId !== envelope.strategyId) {
    throw new ResearchEvidenceProvenanceError("RESEARCH_EVIDENCE_BACKTEST_STRATEGY_MISMATCH");
  }

  if (backtestRun.strategyVersion !== envelope.strategyVersion) {
    throw new ResearchEvidenceProvenanceError("RESEARCH_EVIDENCE_BACKTEST_VERSION_MISMATCH");
  }

  if (backtestRun.costModelVersion !== body.costModelVersion) {
    throw new ResearchEvidenceProvenanceError("RESEARCH_EVIDENCE_COST_MODEL_MISMATCH");
  }

  if (backtestRun.status !== "completed" || !backtestRun.evidenceDigest) {
    throw new ResearchEvidenceProvenanceError("RESEARCH_EVIDENCE_BACKTEST_NOT_COMPLETED");
  }

  const candidate = await getStrategyCandidateByIdPostgres(ex, context, body.strategyCandidateId);
  if (!candidate) {
    throw new ResearchEvidenceProvenanceError("RESEARCH_EVIDENCE_CANDIDATE_NOT_FOUND");
  }

  if (candidate.strategyId !== envelope.strategyId) {
    throw new ResearchEvidenceProvenanceError("RESEARCH_EVIDENCE_CANDIDATE_STRATEGY_MISMATCH");
  }

  if (candidate.strategyVersion !== envelope.strategyVersion) {
    throw new ResearchEvidenceProvenanceError("RESEARCH_EVIDENCE_CANDIDATE_VERSION_MISMATCH");
  }

  if (candidate.status !== "blind_validated") {
    throw new ResearchEvidenceProvenanceError("RESEARCH_EVIDENCE_CANDIDATE_STATUS_INVALID");
  }

  const walkForwardWindows = await listWalkForwardWindowsForCandidatePostgres(
    ex,
    context,
    candidate.id,
  );
  if (walkForwardWindows.length < 1) {
    throw new ResearchEvidenceProvenanceError("RESEARCH_EVIDENCE_WALK_FORWARD_MISSING");
  }

  const blind = await getBlindValidationResultForCandidatePostgres(ex, context, candidate.id);
  if (!blind) {
    throw new ResearchEvidenceProvenanceError("RESEARCH_EVIDENCE_BLIND_RESULT_NOT_FOUND");
  }

  if (blind.id !== body.blindValidationResultId) {
    throw new ResearchEvidenceProvenanceError("RESEARCH_EVIDENCE_BLIND_ID_MISMATCH");
  }

  if (blind.datasetId !== dataset.id) {
    throw new ResearchEvidenceProvenanceError("RESEARCH_EVIDENCE_BLIND_DATASET_MISMATCH");
  }

  if (!candidate.blindUsed) {
    throw new ResearchEvidenceProvenanceError("RESEARCH_EVIDENCE_BLIND_NOT_CONSUMED");
  }

  return {
    datasetId: dataset.id,
    backtestRunId: backtestRun.id,
    strategyCandidateId: candidate.id,
    blindValidationResultId: blind.id,
  };
}
