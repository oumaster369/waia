import type postgres from "postgres";

import { historicalExecutionInstrumentsMatch } from
  "@/lib/trader/execution/historical-execution-symbol";
import {
  issueForecastRuntimeV2,
  requireForecastRuntimeAuthorizedOutcomeV2,
  type ForecastRuntimeInputV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { persistForecastBundleV2 } from
  "@/lib/trader/intelligence/forecast-v2/forecast-v2-persistence-service";
import { buildHistoricalForecastKnowledgeBootstrapV2 } from
  "./forecast-knowledge-bootstrap-v2";

/** Replays authority and atomically persists its exact source bytes with both target forecasts. */
export async function persistHistoricalForecastCycleV2(sql: postgres.Sql, input: Readonly<{
  organizationId: string;
  packageId: string;
  runId: string;
  cycleId: string;
  symbol: "BTCUSDT" | "ETHUSDT";
  runtimeInput: ForecastRuntimeInputV2;
  issuanceSequence: number;
}>): Promise<Readonly<{
  bundleId: string;
  terminalForecastId: string;
  executionForecastId: string;
  retriedExisting: boolean;
}>> {
  if (!Number.isSafeInteger(input.issuanceSequence) || input.issuanceSequence < 0) {
    throw new Error("HISTORICAL_FORECAST_CYCLE_PERSISTENCE_REFUSED:SEQUENCE");
  }
  const issued = issueForecastRuntimeV2(input.runtimeInput);
  if (issued.status !== "FORECAST_AUTHORIZED") {
    throw new Error(
      `HISTORICAL_FORECAST_CYCLE_PERSISTENCE_REFUSED:${issued.reason}`,
    );
  }
  const outcome = requireForecastRuntimeAuthorizedOutcomeV2(issued);
  if (outcome.authority.organizationId !== input.organizationId) {
    throw new Error("HISTORICAL_FORECAST_CYCLE_PERSISTENCE_REFUSED:ORGANIZATION");
  }
  if (!historicalExecutionInstrumentsMatch(
    input.symbol,
    outcome.issuance.package.family.symbol,
  )) {
    throw new Error("HISTORICAL_FORECAST_CYCLE_PERSISTENCE_REFUSED:SYMBOL");
  }
  const historicalKnowledgeBootstrap = buildHistoricalForecastKnowledgeBootstrapV2({
    organizationId: input.organizationId,
    symbol: input.symbol,
    horizonMinutes: input.runtimeInput.executionHorizonMinutes,
    predictivePackageContentDigestHex:
      outcome.authority.selectedPredictivePackageContentDigestHex,
  });
  if (
    input.runtimeInput.knowledgeEdgeId !== historicalKnowledgeBootstrap.knowledgeEdgeId ||
    input.runtimeInput.knowledgeContentDigestHex !== historicalKnowledgeBootstrap.contentDigestHex
  ) {
    throw new Error("HISTORICAL_FORECAST_CYCLE_PERSISTENCE_REFUSED:KNOWLEDGE_LINEAGE");
  }
  return persistForecastBundleV2(sql, {
    organizationId: input.organizationId,
    packageId: input.packageId,
    runId: input.runId,
    cycleId: input.cycleId,
    symbol: input.symbol,
    anchorClosedBarEpochMs: outcome.authority.anchorClosedBarEpochMs,
    issuance: outcome.issuance,
    authorizedOutcome: outcome,
    runtimeInput: input.runtimeInput,
    runtimeAuthorityClass: "HISTORICAL_SIMULATION_V2",
    historicalKnowledgeBootstrap,
    issuanceSequence: input.issuanceSequence,
  });
}
