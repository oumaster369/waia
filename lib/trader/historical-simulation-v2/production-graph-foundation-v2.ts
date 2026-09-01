import type postgres from "postgres";

import { createPostgresHistoricalForecastInputPitLoaderV2 } from "./pit-forecast-input-loader-v2";

const PRODUCTION_GRAPH_BRAND: unique symbol = Symbol("historical-simulation-v2-production-graph");

/** Data-only configuration: deliberately no ports, callbacks, secrets or execution mode. */
export type HistoricalSimulationV2ProductionGraphPrerequisiteInput = Readonly<{
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

export type HistoricalSimulationV2ProductionGraphPrerequisite = Readonly<{
  [PRODUCTION_GRAPH_BRAND]: true;
  scope: Readonly<Pick<HistoricalSimulationV2ProductionGraphPrerequisiteInput,
    "organizationId" | "accountId" | "runId" | "partition" | "symbol">>;
  loadForecastInput: ReturnType<typeof createPostgresHistoricalForecastInputPitLoaderV2>;
}>;

/** PIT-input prerequisite only. This is deliberately not a closed production simulation graph. */
export function createHistoricalSimulationV2ProductionGraphPrerequisite(
  input: HistoricalSimulationV2ProductionGraphPrerequisiteInput,
): HistoricalSimulationV2ProductionGraphPrerequisite {
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
