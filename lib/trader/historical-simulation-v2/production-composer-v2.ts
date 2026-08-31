import type postgres from "postgres";

import {
  createHistoricalDecisionEconomicsPortfolioResolverV2,
  runHistoricalSimulationV2,
  type HistoricalSimulationV2Cycle,
  type HistoricalSimulationV2Evidence,
  type RunHistoricalSimulationV2Input,
  type RunHistoricalSimulationV2Result,
} from "@/lib/trader/backtest/historical-simulation-v2";
import type { HistoricalSimulationReasonLedgerV2 } from "@/lib/trader/historical-simulation-v2/reason-ledger-v2";
import { assertFhvDatasetSealed } from "@/lib/trader/market-data/fhv-dataset-seal";
import {
  assertHtxVolumeAuthorityQualified,
} from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import type { ForecastRuntimeInputV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import type { ForecastV2DurableProducerConfigV1 } from "@/lib/trader/intelligence/outcome-resolution/epistemic-closure-runtime";
import { assertFhvV2PostgresSchemaPreflight } from "@/lib/trader/observability/fhv-v2-postgres-schema-preflight";
import {
  createHistoricalDecisionEconomicsProductionInputBuilderV2,
  type PersistedDecisionEconomicsAuthorityPortV2,
} from "@/lib/trader/historical-simulation-v2/decision-economics-production-adapter-v2";
import { createHistoricalSimulationPostgresKnowledgePortV2 } from "@/lib/trader/historical-simulation-v2/knowledge-port-postgres";
import {
  assertHistoricalMarketCycleV2,
  type HistoricalSealedMarketCycleV2,
} from "@/lib/trader/historical-simulation-v2/modeled-execution-advance-v2";

export type HistoricalSimulationV2ProductionComposerInput = Readonly<{
  sql: postgres.Sql;
  repoRoot: string;
  datasetRoot: string;
  organizationId: string;
  accountId: string;
  runId: string;
  partition: "DEVELOPMENT" | "WALK_FORWARD";
  symbol: "BTCUSDT" | "ETHUSDT";
  cycles: readonly HistoricalSealedMarketCycleV2[];
  defaultQuantity: string;
  authorities: PersistedDecisionEconomicsAuthorityPortV2;
  knowledgeProducer: Omit<ForecastV2DurableProducerConfigV1, "sql">;
  resolveForecastInput(input: Readonly<{
    cycle: HistoricalSealedMarketCycleV2;
    knowledge: Awaited<ReturnType<RunHistoricalSimulationV2Input["knowledge"]["snapshotAsOf"]>>;
  }>): Promise<ForecastRuntimeInputV2>;
  capital: Pick<
    RunHistoricalSimulationV2Input,
    "decisionCapitalAuthorityV2" | "modeledExit" | "resolveLedgerProjection"
  >;
  persistEvidence(evidence: HistoricalSimulationV2Evidence): Promise<void>;
  persistReasonLedger(entry: HistoricalSimulationReasonLedgerV2): Promise<void>;
}>;

function validateCycle(
  cycle: HistoricalSealedMarketCycleV2,
  expected: Pick<HistoricalSimulationV2ProductionComposerInput, "partition" | "symbol">,
): HistoricalSimulationV2Cycle {
  assertHistoricalMarketCycleV2(cycle, cycle.cycleId);
  if (cycle.closedBar.symbol.replace("/", "") !== expected.symbol) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:SYMBOL_MISMATCH");
  }
  if (
    !Number.isFinite(cycle.htxVolumeRaw.amount) || cycle.htxVolumeRaw.amount < 0 ||
    !Number.isFinite(cycle.htxVolumeRaw.vol) || cycle.htxVolumeRaw.vol < 0 ||
    Number(cycle.closedBar.volume) !== cycle.htxVolumeRaw.amount
  ) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:VOLUME_AUTHORITY");
  }
  assertHtxVolumeAuthorityQualified(cycle.htxVolumeAuthorityReceipt);
  if (cycle.htxVolumeAuthorityReceipt.symbol.replace("/", "") !== expected.symbol) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:VOLUME_RECEIPT_SCOPE");
  }
  return Object.freeze({
    cycleId: cycle.cycleId,
    observedAt: cycle.closedBar.barCloseTime,
    symbol: cycle.closedBar.symbol,
    referencePrice: String(cycle.closedBar.close),
  });
}

/**
 * Production fail-closed composition. It intentionally accepts no credentials, connector,
 * paper/live mode or TEST_ONLY authority. Canonical Reality V2 is not part of this graph.
 */
export async function runHistoricalSimulationV2Production(
  input: HistoricalSimulationV2ProductionComposerInput,
): Promise<RunHistoricalSimulationV2Result> {
  // Required to be the first effect: before reading/sealing launch data or loading authorities.
  await assertFhvV2PostgresSchemaPreflight({ sql: input.sql, repoRoot: input.repoRoot });

  if (input.partition !== "DEVELOPMENT" && input.partition !== "WALK_FORWARD") {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:BLIND_HOLDOUT");
  }
  const sealed = assertFhvDatasetSealed(input.datasetRoot);
  if (
    sealed.manifest.organizationId !== input.organizationId ||
    !sealed.manifest.partitions.some((entry) =>
      entry.partition === (input.partition === "DEVELOPMENT" ? "development" : "walk-forward") &&
      entry.symbol === input.symbol)
  ) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:SEALED_DATASET_SCOPE");
  }

  const cycleById = new Map(input.cycles.map((cycle) => [cycle.cycleId, cycle]));
  if (cycleById.size !== input.cycles.length) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:DUPLICATE_CYCLE");
  }
  const cycles = input.cycles.map((cycle) => validateCycle(cycle, input));
  const knowledge = createHistoricalSimulationPostgresKnowledgePortV2({
    sql: input.sql,
    organizationId: input.organizationId,
    symbol: input.symbol,
    forecastProducer: input.knowledgeProducer,
  });
  const decisionInput = createHistoricalDecisionEconomicsProductionInputBuilderV2({
    organizationId: input.organizationId,
    accountId: input.accountId,
    authorities: input.authorities,
  });
  const resolvePortfolioProposal = createHistoricalDecisionEconomicsPortfolioResolverV2({
    buildEvaluationInput: decisionInput,
  });

  return runHistoricalSimulationV2({
    organizationId: input.organizationId,
    accountId: input.accountId,
    runId: input.runId,
    split: input.partition === "DEVELOPMENT" ? "development" : "walk_forward",
    authority: "HISTORICAL_SIMULATION_V2",
    cycles,
    defaultQuantity: input.defaultQuantity,
    knowledge,
    resolveForecastInput: ({ cycle, knowledge }) => {
      const sealedCycle = cycleById.get(cycle.cycleId);
      if (!sealedCycle) throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:CYCLE_NOT_FOUND");
      return input.resolveForecastInput({ cycle: sealedCycle, knowledge });
    },
    resolvePortfolioProposal,
    forecastLifecycleSink: async ({ cycle, forecast }) => {
      const sequence = cycles.findIndex((candidate) => candidate.cycleId === cycle.cycleId);
      if (sequence < 0) throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:CYCLE_NOT_FOUND");
      await knowledge.processForecastCycle({
        organizationId: input.organizationId,
        runId: input.runId,
        cycleId: cycle.cycleId,
        pitAnchor: cycle.observedAt,
        bars: input.cycles.slice(0, sequence + 1).map((value) => value.closedBar),
        sequence,
        outcome: forecast.status === "FORECAST_AUTHORIZED" ? forecast : null,
      });
    },
    ...input.capital,
    // The exact preflight already ran before all composition effects. Avoid a second DB scan.
    postgresSchemaPreflight: async () => undefined,
    evidenceSink: input.persistEvidence,
    reasonLedgerSink: input.persistReasonLedger,
  });
}
