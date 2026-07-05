import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { createHash } from "node:crypto";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { deriveEvidenceFromMetrics } from "@/lib/trader/discovery/evidence-ledger";
import type {
  SimulationBrokerDeps,
  SimulationBrokerInput,
  SimulationBrokerRegisterDeps,
  SimulationBrokerResult,
} from "@/lib/trader/discovery/simulation-broker.types";
import { collectRegimeLabelsFromMetrics } from "@/lib/trader/research/regime-coverage";
import { evaluateMultiRegimeCoverage } from "@/lib/trader/research/regime-coverage";
import {
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
  type ResearchValidationMetrics,
} from "@/lib/trader/research/strategy-candidate.types";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import { assertNoBannedFields } from "@/lib/trader/discovery/no-reinforcement-guard";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update" | "delete">;

function buildMetricsDigest(metrics: ResearchValidationMetrics): string {
  return createHash("sha256").update(canonicalJsonString(metrics), "utf8").digest("hex");
}

function countClosedTrades(metrics: ResearchValidationMetrics): number {
  if ("closedTrades" in metrics) {
    return metrics.closedTrades;
  }
  return metrics.tradeCount;
}

export async function runSimulationBroker(
  ex: PgExecutor,
  deps: SimulationBrokerDeps,
  input: SimulationBrokerInput,
): Promise<SimulationBrokerResult> {
  assertNoBannedFields(input, "simulationBrokerInput");

  const pipelineResult = await deps.runPipeline(ex, input.pipelineInput);
  const blindMetrics = pipelineResult.blindMetrics;
  const regimeLabels = collectRegimeLabelsFromMetrics([blindMetrics]);
  const coverage = evaluateMultiRegimeCoverage(regimeLabels);

  const evidenceRecords = deriveEvidenceFromMetrics({
    organizationId: input.context.organizationId,
    campaignId: input.campaignId,
    candidateRef: pipelineResult.strategyCandidateId,
    sourceRunDigest: buildMetricsDigest(blindMetrics),
    observedRegimeLabels: regimeLabels,
    satisfiesMultiRegimeCoverage: coverage.satisfiesRequirement,
    blindConsumed: true,
    walkForwardWindowCount: pipelineResult.walkForwardWindowCount,
    closedTradeCount: countClosedTrades(blindMetrics),
    builderGitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
  });

  return {
    candidateId: pipelineResult.strategyCandidateId,
    metricsDigest: buildMetricsDigest(blindMetrics),
    pipelineResult,
    evidenceRecords,
  };
}

export async function registerSimulationCandidate(
  ex: PgExecutor,
  deps: SimulationBrokerRegisterDeps,
  input: Parameters<SimulationBrokerDeps["registerCandidate"]>[2],
  context: Parameters<SimulationBrokerDeps["registerCandidate"]>[1],
): Promise<Awaited<ReturnType<SimulationBrokerDeps["registerCandidate"]>>> {
  return deps.registerCandidate(ex, context, input);
}
