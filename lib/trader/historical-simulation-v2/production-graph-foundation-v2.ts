import type postgres from "postgres";

import { createPostgresHistoricalForecastInputPitLoaderV2 } from "./pit-forecast-input-loader-v2";

const PRODUCTION_GRAPH_BRAND: unique symbol = Symbol("historical-simulation-v2-production-graph");

/** Data-only configuration: deliberately no ports, callbacks, secrets or execution mode. */
export type HistoricalSimulationV2ProductionGraphFoundationInput = Readonly<{
  sql: postgres.Sql;
  repoRoot: string;
  datasetRoot: string;
  organizationId: string;
  accountId: string;
  runId: string;
  partition: "DEVELOPMENT" | "WALK_FORWARD";
  symbol: "BTCUSDT" | "ETHUSDT";
  defaultQuantity: string;
}>;

export type HistoricalSimulationV2ProductionGraphFoundation = Readonly<{
  [PRODUCTION_GRAPH_BRAND]: true;
  scope: Readonly<Pick<HistoricalSimulationV2ProductionGraphFoundationInput,
    "organizationId" | "accountId" | "runId" | "partition" | "symbol">>;
  loadForecastInput: ReturnType<typeof createPostgresHistoricalForecastInputPitLoaderV2>;
}>;

export function createHistoricalSimulationV2ProductionGraphFoundation(
  input: HistoricalSimulationV2ProductionGraphFoundationInput,
): HistoricalSimulationV2ProductionGraphFoundation {
  if (!input.organizationId || !input.accountId || !input.runId || input.defaultQuantity.trim() === "" ||
      (input.partition !== "DEVELOPMENT" && input.partition !== "WALK_FORWARD")) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_GRAPH_REFUSED:INVALID_SCOPE");
  }
  return Object.freeze({
    [PRODUCTION_GRAPH_BRAND]: true as const,
    scope: Object.freeze({
      organizationId: input.organizationId, accountId: input.accountId, runId: input.runId,
      partition: input.partition, symbol: input.symbol,
    }),
    loadForecastInput: createPostgresHistoricalForecastInputPitLoaderV2(input.sql),
  });
}
