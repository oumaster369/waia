import type postgres from "postgres";

/**
 * Resolves the first executable record from the append-only run-start lineage.
 * The predictive/economic boundary is not record zero, so production must never
 * infer this index from a fresh resume cursor or accept it from runner input.
 */
export async function loadHistoricalSimulationInitialRecordIndexV2(input: Readonly<{
  tx: postgres.Sql;
  organizationId: string;
  accountId: string;
  runId: string;
  partition: "DEVELOPMENT" | "WALK_FORWARD";
  symbol: "BTCUSDT" | "ETHUSDT";
}>): Promise<number> {
  const rows = await input.tx<Array<Readonly<{
    record_index: number;
    cycle_id: string;
    preregistration_cycle_id: string;
  }>>>`
    SELECT pit.record_index, pit.cycle_id,
      prereg.cycle_id AS preregistration_cycle_id
    FROM trader_historical_simulation_run_start_v2 run_start
    JOIN trader_dee659_authority_preregistration_v2 prereg
      ON prereg.id=run_start.initial_dee659_preregistration_id
      AND prereg.organization_id=run_start.organization_id
      AND prereg.account_id=run_start.account_id
      AND prereg.run_id=run_start.run_id
      AND prereg.dataset_authority_digest_hex=run_start.dataset_authority_digest_hex
      AND prereg.policy_config_digest_hex=run_start.policy_config_digest_hex
    JOIN trader_historical_forecast_input_pit_v2 pit
      ON pit.organization_id=run_start.organization_id
      AND pit.run_id=run_start.run_id
      AND pit.cycle_id=prereg.cycle_id
      AND pit.forecast_id::text=prereg.forecast_id::text
      AND pit.dataset_authority_digest_hex=run_start.dataset_authority_digest_hex
    WHERE run_start.organization_id=${input.organizationId}::uuid
      AND run_start.account_id=${input.accountId}
      AND run_start.run_id=${input.runId}
      AND pit.partition=${input.partition}
      AND pit.symbol=${input.symbol}
  `;
  const row = rows[0];
  if (rows.length !== 1 || !row || row.cycle_id !== row.preregistration_cycle_id ||
      !Number.isSafeInteger(row.record_index) || row.record_index < 0) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:INITIAL_RECORD_IDENTITY");
  }
  const expectedCycleId = `${input.runId}:${input.partition}:${input.symbol}:${row.record_index}`;
  if (row.cycle_id !== expectedCycleId) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:INITIAL_RECORD_IDENTITY");
  }
  return row.record_index;
}
